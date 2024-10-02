import * as fs from 'fs/promises';
import zlib from 'zlib';
import { join, dirname } from 'path';
import { promisify } from 'util';
import crypto from 'crypto'

const args = process.argv.slice(2);
const command = args[0];

enum Commands {
    Init = "init",
    Cat_File = "cat-file",
    Hash_Object = "hash-object",
    Ls_Tree = "ls-tree",
    Write_Tree = "write-tree"
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

        default:
            throw new Error(`Unknown command ${command}`);
    }
};

main().catch(err => {
    console.error("An error occurred:", err);
    process.exit(1);
});