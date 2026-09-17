import mongoose from 'mongoose';
import dns from 'node:dns';

// Ensure Node.js can resolve external records reliably
try {
    dns.setServers(['8.8.8.8', '1.1.1.1']);
} catch {
    // Ignore if custom DNS cannot be configured
}

function getMongoUri(): string {
    let uri = process.env.MONGODB_URI || '';
    if (!uri) return '';
    // Automatically escape unencoded '@' in credentials if present
    if (uri.includes('://') && uri.includes('@')) {
        const parts = uri.split('://');
        const scheme = parts[0];
        const rest = parts[1];
        const atParts = rest.split('@');
        if (atParts.length > 2) {
            const hostPart = atParts.pop();
            const credPart = atParts.join('@');
            const colonIdx = credPart.indexOf(':');
            if (colonIdx !== -1) {
                const user = credPart.slice(0, colonIdx);
                const pass = credPart.slice(colonIdx + 1);
                uri = `${scheme}://${encodeURIComponent(user)}:${encodeURIComponent(pass)}@${hostPart}`;
            }
        }
    }
    return uri;
}

let cached = (global as any).mongoose || { conn: null, promise: null };

async function resolveSrvFallback(srvUri: string): Promise<string> {
    try {
        const match = srvUri.match(/^mongodb\+srv:\/\/([^@]+)@([^/?]+)(\/[^?]*)?(\?.*)?$/);
        if (!match) return srvUri;
        const [, auth, host, path = '/mcapduel', query = ''] = match;

        dns.setServers(['8.8.8.8', '1.1.1.1']);
        const srvRecords = await dns.promises.resolveSrv(`_mongodb._tcp.${host}`);
        if (!srvRecords || srvRecords.length === 0) return srvUri;

        const hostList = srvRecords.map((r) => `${r.name}:${r.port}`).join(',');

        let extraParams = 'ssl=true';
        try {
            const txtRecords = await dns.promises.resolveTxt(host);
            if (txtRecords && txtRecords.length > 0) {
                const txt = txtRecords.flat().join('&');
                if (txt) extraParams += `&${txt}`;
            }
        } catch {}

        const sep = query ? (query.includes('?') ? '&' : '?') : '?';
        return `mongodb://${auth}@${hostList}${path}${query}${sep}${extraParams}`;
    } catch {
        return srvUri;
    }
}

export async function connectToDatabase() {
    if (cached.conn) return cached.conn;

    const MONGODB_URI = getMongoUri();
    if (!MONGODB_URI) {
        throw new Error("Please define the MONGODB_URI environment variable inside .env.local");
    }

    if (!cached.promise) {
        cached.promise = (async () => {
            try {
                dns.setServers(['8.8.8.8', '1.1.1.1']);
            } catch {}

            try {
                return await mongoose.connect(MONGODB_URI, { bufferCommands: false });
            } catch (err: any) {
                if (
                    err &&
                    (err.code === 'ECONNREFUSED' || err.message?.includes('querySrv')) &&
                    MONGODB_URI.startsWith('mongodb+srv://')
                ) {
                    console.log('[mongoose] SRV query failed, falling back to direct replica set resolution...');
                    const directUri = await resolveSrvFallback(MONGODB_URI);
                    if (directUri !== MONGODB_URI) {
                        return await mongoose.connect(directUri, { bufferCommands: false });
                    }
                }
                throw err;
            }
        })()
            .then((m) => {
                console.log('[mongoose] connected to MongoDB successfully');
                return m;
            })
            .catch((err) => {
                console.error('[mongoose] connect error:', err.message);
                cached.promise = null;
                throw err;
            });
    }

    cached.conn = await cached.promise;
    return cached.conn;
}
