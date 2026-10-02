import { handle } from '../../../../lib/api/router';
export const dynamic = 'force-dynamic';
// PUT is exported only so unsupported methods get a problem+json 405 with Allow.
export { handle as GET, handle as POST, handle as PATCH, handle as DELETE, handle as PUT };
