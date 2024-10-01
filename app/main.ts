import * as fs from 'fs/promises';  // Change this line
import zlib from 'zlib';
import { join } from 'path';
import { promisify } from 'util';
import crypto from 'crypto'

const args = process.argv.slice(2);
const command = args[0];

enum Commands {
    Init = "init",
    Cat_File = "cat-file",
    Hash_Object = "hash-object"
}

const inflate = promisify(zlib.inflate);
const deflate = promisify(zlib.deflate)

const calculateSHA1 = (input: string) => {
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

const writeObject = async (contentFile: string) => {
    const content = await fs.readFile(contentFile)
    const size = content.length
    const objectContent = `blob ${size}\0${content}`
    const compressedData = await deflate(objectContent)
    const sha1 = calculateSHA1(objectContent)
    await fs.mkdir(`.git/objects/${sha1.slice(0, 2)}`, { recursive: true });
    await fs.writeFile(`.git/objects/${sha1.slice(0, 2)}/${sha1.slice(2)}`, compressedData)

    console.log(sha1)
}

const main = async (): Promise<void> => {
    switch (command) {
        case Commands.Init:
            await init();
            break;
        case Commands.Cat_File:
            await readObject(".git/objects", args[2]);
            break;
        case Commands.Hash_Object:
            if (args[1] == "-w")
                await writeObject(args[2])
            break;

        default:
            throw new Error(`Unknown command ${command}`);
    }
};

main().catch(err => {
    console.error("An error occurred:", err);
    process.exit(1);
});