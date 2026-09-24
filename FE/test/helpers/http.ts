import { NextRequest } from 'next/server';

/** A NextRequest carrying a JSON body plus a default request IP (WalletSighting/geofence signal). */
export function postJson(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9', ...headers },
  });
}

export function patchJson(url: string, body: unknown, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, {
    method: 'PATCH',
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-forwarded-for': '9.9.9.9', ...headers },
  });
}

export function getReq(url: string, headers: Record<string, string> = {}): NextRequest {
  return new NextRequest(url, { headers: { 'x-forwarded-for': '9.9.9.9', ...headers } });
}

export async function body(res: Response) {
  return res.json();
}
