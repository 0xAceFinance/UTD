const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-admin-secret, x-forwarded-for, x-real-ip',
};

export function success(data: any, status = 200) {
    return new Response(JSON.stringify({ success: true, data }), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS,
        }
    });
}

export function failure(error: any, status = 500) {
    return new Response(JSON.stringify({ success: false, error }), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...CORS_HEADERS,
        }
    });
}
