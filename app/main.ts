import * as fs from 'fs/promises';
import zlib from 'zlib';
import { join, dirname } from 'path';
import { promisify } from 'util';
import crypto from 'crypto'
import NetClient from "./client"

const args = process.argv.slice(2);
const command = args[0];

enum Commands {
    Init = "init",
    Cat_File = "cat-file",
    Hash_Object = "hash-object",
    Ls_Tree = "ls-tree",
    Write_Tree = "write-tree",
    Commit_Tree = "commit-tree",
    Clone = "clone"
}

const inflate = promisify(zlib.inflate);
const deflate = promisify(zlib.deflate)

const calculateSHA1 = (input: Buffer | string) => {
    const hash = crypto.createHash('sha1');
    hash.update(input);
    return hash.digest('hex');
}

const readObject = async (repoPath: string, sha: string): Promise<void> => {
    try {
        const objectPath = join(repoPath, sha.slice(0, 2), sha.slice(2));
        const compressedData = await fs.readFile(objectPath);
        const decompressedData = await inflate(compressedData);
        // Parse the object header
        const nullIndex = decompressedData.indexOf(0);
        if (nullIndex === -1) {
            throw new Error('Invalid object format');
        }

        // Extract the content (everything after the null byte)
        const content = decompressedData.slice(nullIndex + 1);

        // Output only the content
        process.stdout.write(content);
        // console.log(decompressedData.toString().trim());
    } catch (err) {
        if (err instanceof Error) {
            console.error(`Error reading object ${sha}: ${err.message}`);
        } else {
            console.error(`An unknown error occurred while reading object ${sha}`);
        }
    }
};

const init = async (): Promise<void> => {
    try {
        await fs.mkdir(".git", { recursive: true });
        await fs.mkdir(".git/objects", { recursive: true });
        await fs.mkdir(".git/refs", { recursive: true });
        await fs.writeFile(".git/HEAD", "ref: refs/heads/main\n");
        console.log("Initialized git directory");
    } catch (err) {
        if (err instanceof Error) {
            console.error(`Error initializing git directory: ${err.message}`);
        } else {
            console.error("An unknown error occurred while initializing git directory");
        }
    }
};

const writeBlobObject = async (contentFile: string) => {
    const content = await fs.readFile(contentFile)
    const size = content.length
    const objectContent = `blob ${size}\0${content}`
    const compressedData = await deflate(objectContent)
    const sha1 = calculateSHA1(objectContent)
    await fs.mkdir(`.git/objects/${sha1.slice(0, 2)}`, { recursive: true });
    await fs.writeFile(`.git/objects/${sha1.slice(0, 2)}/${sha1.slice(2)}`, compressedData)
    return sha1
}

const splitBufferChunks = (buffer: Buffer) => {
    // Convert buffer to string
    const content = buffer.toString('binary');

    // Regex pattern
    // (\d+) - captures the mode (one or more digits)
    // \s - matches a space
    // ([^\0]+) - captures the name (one or more non-null characters)
    // \0 - matches the null byte
    // ([\s\S]{20}) - captures exactly 20 characters (the SHA)
    const pattern = /(\d+)\s([^\0]+)\0([\s\S]{20})/g;

    const chunks = [];
    let match;

    while ((match = pattern.exec(content)) !== null) {
        chunks.push({
            mode: match[1],
            name: match[2],
            sha: Buffer.from(match[3], 'binary').toString('hex')
        });
    }

    return chunks;
};
const readTree = async (repoPath: string, treeSHA: string) => {
    const path = join(repoPath, treeSHA.slice(0, 2), treeSHA.slice(2))
    const compressedData = await fs.readFile(path)
    const decompressedData = await inflate(compressedData)
    const headerEndIndex = decompressedData.indexOf(0) + 1
    const chunks = splitBufferChunks(decompressedData.slice(headerEndIndex))

    chunks.map((chunk) => {

        console.log(chunk.name)
    })

}

enum modes {
    REGULAR_FILE = "100644",
    EXECUTABLE_FILE = "100755",
    SYMBOLIC_FILE = "120000",
    DIRECTORY = "40000"
}
interface TreeEntry {
    mode: modes,
    name: string,
    sha: string
}


const writeTreeObject = async (objectShaList: TreeEntry[]) => {
    // Sort the entries
    objectShaList.sort((a, b) => a.name.localeCompare(b.name));

    let content = Buffer.alloc(0);
    for (const item of objectShaList) {
        const entryContent = Buffer.concat([
            Buffer.from(`${item.mode} ${item.name}\0`),
            Buffer.from(item.sha, 'hex')  // Convert hex SHA to binary
        ]);
        content = Buffer.concat([content, entryContent]);
    }

    const header = Buffer.from(`tree ${content.length}\0`);
    const objectContent = Buffer.concat([header, content]);

    const compressedData = await deflate(objectContent);
    const sha1 = calculateSHA1(objectContent);

    const objectPath = join('.git', 'objects', sha1.slice(0, 2), sha1.slice(2));
    await fs.mkdir(dirname(objectPath), { recursive: true });
    await fs.writeFile(objectPath, compressedData);

    return sha1;
}

const writeTree = async (repo: string): Promise<string> => {
    const entries = await fs.readdir(repo, { withFileTypes: true });
    const shaObjects: TreeEntry[] = [];

    for (const entry of entries) {
        if (entry.name === '.git') continue;  // Skip .git directory

        const fullPath = join(repo, entry.name);
        let sha: string;
        let mode: modes;

        try {
            if (entry.isDirectory()) {
                sha = await writeTree(fullPath);
                mode = modes.DIRECTORY;
            } else {
                sha = await writeBlobObject(fullPath);
                mode = modes.REGULAR_FILE;
            }

            shaObjects.push({ mode, name: entry.name, sha });
        } catch (error) {
            console.error(`Error processing ${fullPath}:`, error);
        }
    }

    return await writeTreeObject(shaObjects);
}

interface CommitObject {
    treeSha: string,
    parentCommitSha: string,
    authorName: string,
    authorEmail: string,
    committerEmail: string,
    committerName: string,
    message: string,
    timestamp: string
}

const writeCommit = async (commitObj: CommitObject) => {
    let content = Buffer.alloc(0)
    content = Buffer.concat([Buffer.from(`tree ${commitObj.treeSha}\nparent ${commitObj.parentCommitSha}`)])
    content = Buffer.concat([content, Buffer.from(" "), Buffer.from(`author ${commitObj.authorName} ${commitObj.authorEmail} ${commitObj.timestamp}`)])
    content = Buffer.concat([content, Buffer.from(" "), Buffer.from(`committer ${commitObj.committerName} ${commitObj.committerEmail} ${commitObj.timestamp}`)])
    content = Buffer.concat([content, Buffer.from("\n\n"), Buffer.from(commitObj.message), Buffer.from("\n")])

    const header = Buffer.from(`commit ${content.length}\0`);
    const objectContent = Buffer.concat([header, content]);
    const compressedData = await deflate(objectContent);
    const sha1 = calculateSHA1(objectContent);

    const objectPath = join('.git', 'objects', sha1.slice(0, 2), sha1.slice(2));
    await fs.mkdir(dirname(objectPath), { recursive: true });
    await fs.writeFile(objectPath, compressedData);
    return sha1
}

interface Remote {
    port?: string,
    host: string,
    repoPath: string
}

const parseRefsDiscoveryReponse = (response: string): { refs: Map<string, string>, capabilities: string[] } => {
    const lines = response.trim().split('\n')
    const refs: Map<string, string> = new Map<string, string>()
    let capabilities: string[] = []
    lines.forEach(line => {
        // Skip the length prefix and service announcement
        if (line.startsWith("# ") || line === '0000') return
        const content = line.slice(4);  // Remove the 4-digit length prefix
        // const [sha, ref] = line.split('\t')
        if (content.includes('\0')) {
            // This is the first line with capabilities
            const [refInfo, caps] = content.split('\0');
            const [sha, ref] = refInfo.split(' ');
            capabilities = caps.split(' ');
            refs.set(ref, sha);

        } else if (content.includes(' ')) {
            const [sha, ref] = content.split(' ');
            refs.set(ref, sha);
        }
    })
    return { refs, capabilities }

}
function prepareWantRequest(wants: string[], capabilities: string[]): string {
    let request = `0032want ${wants[0]} ${capabilities.join(' ')}\n`;
    for (let i = 1; i < wants.length; i++) {
        request += `0032want ${wants[i]}\n`;
    }
    request += '00000009done\n';
    return request;
}
async function processPackfileResponse(response: Buffer, localDir: string) {
    let offset = 0;
    const packfile: Buffer[] = [];

    while (offset < response.length) {
        const length = response.readUInt32BE(offset);
        offset += 4;

        if (length === 0) break; // End of response

        const type = response[offset];
        offset += 1;

        const data = response.slice(offset, offset + length - 5);
        offset += length - 5;

        switch (type) {
            case 1: // Pack data
                packfile.push(data);
                break;
            case 2: // Progress info
                console.log(`Progress: ${data.toString()}`);
                break;
            case 3: // Error message
                throw new Error(`Server error: ${data.toString()}`);
        }
    }

    if (packfile.length === 0) {
        throw new Error("No packfile received");
    }

    const fullPackfile = Buffer.concat(packfile);
    await processPackfile(fullPackfile, localDir);
}

async function processPackfile(packfileData: Buffer, localDir: string) {
    let offset = 0;

    // Check the packfile signature
    const signature = packfileData.slice(offset, offset + 4).toString('ascii');
    if (signature !== 'PACK') {
        throw new Error(`Invalid packfile signature: ${signature}`);
    }
    offset += 4;

    // Read version
    const version = packfileData.readUInt32BE(offset);
    offset += 4;

    // Read number of objects
    const numObjects = packfileData.readUInt32BE(offset);
    offset += 4;

    console.log(`Packfile version: ${version}, Number of objects: ${numObjects}`);

    for (let i = 0; i < numObjects; i++) {
        const objectData = await extractObject(packfileData, offset);
        offset = objectData.nextOffset;

        // Write the object to the local repository
        await writeObject(localDir, objectData.type, objectData.data);
    }

    console.log(`Processed ${numObjects} objects`);
}

async function extractObject(data: Buffer, offset: number): Promise<{ type: string, data: Buffer, nextOffset: number }> {
    let byte = data[offset++];
    const type = (byte >> 4) & 7;
    let size = byte & 15;
    let shift = 4;

    while (byte & 0x80) {
        byte = data[offset++];
        size |= (byte & 0x7f) << shift;
        shift += 7;
    }

    let objectData: Buffer;
    if (type === 6 || type === 7) {  // OFS_DELTA or REF_DELTA
        // For delta objects, we need to apply the delta to the base object
        // This is a simplified version; full implementation would be more complex
        console.log(`Delta object found. Type: ${type === 6 ? 'OFS_DELTA' : 'REF_DELTA'}`);
        objectData = data.slice(offset, offset + size);
        offset += size;
    } else {
        // For non-delta objects, we can decompress directly
        const compressed = data.slice(offset);
        objectData = zlib.inflateSync(compressed);
        offset += size;
    }

    const typeString = ['', 'commit', 'tree', 'blob', 'tag', '', 'ofs-delta', 'ref-delta'][type];

    return { type: typeString, data: objectData, nextOffset: offset };
}

async function writeObject(repoPath: string, type: string, data: Buffer) {
    const hash = crypto.createHash('sha1');
    const content = Buffer.concat([Buffer.from(`${type} ${data.length}\0`), data]);
    hash.update(content);
    const sha1 = hash.digest('hex');

    const objectsDir = join(repoPath, '.git', 'objects');
    const objectDir = join(objectsDir, sha1.slice(0, 2));
    const objectPath = join(objectDir, sha1.slice(2));

    await fs.mkdir(objectDir, { recursive: true });
    await fs.writeFile(objectPath, zlib.deflateSync(content));

    console.log(`Wrote ${type} object: ${sha1}`);
}

const transportAndPackWire = async (url: string, localDir: string) => {
    await fs.mkdir(localDir, { recursive: true });
    const remote: Remote = {
        host: "github.com",
        repoPath: url.replace("https://github.com", "")
    };
    const client = new NetClient(remote.host);

    try {
        // Reference discovery
        const response = await client.sendRequest(`${remote.repoPath}/info/refs?service=git-upload-pack`);
        const { refs, capabilities } = parseRefsDiscoveryReponse(response);
        // For a full clone, we want all refs
        const wants = Array.from(refs.values());

        // Prepare the want request
        const wantRequest = prepareWantRequest(wants, capabilities);

        // Send the want request
        const packfileResponse = await client.sendPostRequest(`${remote.repoPath}/git-upload-pack`, wantRequest);
        console.log("Packfile response length:", packfileResponse.length);
        console.log("Packfile response (first 100 bytes):", packfileResponse.slice(0, 100).toString('hex'));

        // Process the packfile
        await processPackfileResponse(packfileResponse, localDir)
    } catch (error) {
        console.error("Error during git clone:", error);
    }
};


const main = async (): Promise<void> => {
    let sha: string = ""
    switch (command) {
        case Commands.Init:
            await init();
            break;
        case Commands.Cat_File:
            await readObject(".git/objects", args[2]);
            break;
        case Commands.Hash_Object:
            if (args[1] == "-w")
                sha = await writeBlobObject(args[2])
            console.log(sha)
            break;
        case Commands.Ls_Tree:
            if (args[1] === "--name-only") {
                readTree(".git/objects", args[2])
            }
            break

        case Commands.Write_Tree:
            sha = await writeTree("./")
            console.log(sha)
            break

        case Commands.Commit_Tree:
            const treeSha = args[1]
            const parentCommitSha = args[3]
            const commitMessage = args[5]

            sha = await writeCommit({
                treeSha,
                parentCommitSha,
                authorEmail: "surajydv3@gmail.com",
                authorName: "suraj",
                committerEmail: "surajydv3@gmail.com",
                committerName: "suraj",
                timestamp: Date.now().toString(),
                message: commitMessage
            })
            console.log(sha)
            break

        case Commands.Clone:
            console.log(args[1], args[2])

            await transportAndPackWire(args[1], args[2])
            break

        default:
            throw new Error(`Unknown command ${command}`);
    }
};

main().catch(err => {
    console.error("An error occurred:", err);
    process.exit(1);
});