import * as https from 'https'

export default class NetClient {
    constructor(private host: string) { }

    sendRequest = (path: string) => {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: this.host,
                path: path,
                port: 443,
                method: 'GET',
                headers: {
                    'User-Agent': 'git/2.0.0'
                }
            }
            const req = https.request(options, (res) => {
                let data: string = '';
                res.on('data', (chunk) => {
                    data += chunk
                })
                res.on('end', () => {
                    resolve(data)
                })
                res.on('error', (error) => {
                    reject(error)
                })
            })
            req.end()
        })
    }

    sendPostRequest = (path: string, data: string): Promise<Buffer> => {
        return new Promise((resolve, reject) => {
            const options = {
                hostname: this.host,
                port: 443,
                path: path,
                method: 'POST',
                headers: {
                    'User-Agent': 'git/2.0.0',
                    'Content-Type': 'application/x-git-upload-pack-request',
                    'Accept': 'application/x-git-upload-pack-result',
                    'Content-Length': Buffer.byteLength(data)
                }
            };

            console.log('Sending POST request with options:', JSON.stringify(options));
            console.log('Request data:', data);

            const req = https.request(options, (res) => {
                console.log('Response status:', res.statusCode);
                console.log('Response headers:', res.headers);

                const chunks: Buffer[] = [];
                res.on('data', (chunk: Buffer) => {
                    console.log('Received chunk of size:', chunk.length);
                    chunks.push(chunk);
                });
                res.on('end', () => {
                    const responseData = Buffer.concat(chunks);
                    console.log('Total response size:', responseData.length);
                    resolve(responseData);
                });
            });

            req.on('error', (error) => {
                console.error('Request error:', error);
                reject(error);
            });

            req.write(data);
            req.end();
        });
    }

}