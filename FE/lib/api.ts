/**
 * Centralized API base URL pointing to the Google Cloud Run backend.
 */
export const API_BASE_URL =
    process.env.NEXT_PUBLIC_API_URL ||
    'https://utd-backend-998336196389.us-central1.run.app';

export function apiUrl(path: string): string {
    const cleanPath = path.startsWith('/') ? path : `/${path}`;
    return `${API_BASE_URL}${cleanPath}`;
}
