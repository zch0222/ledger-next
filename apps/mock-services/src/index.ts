import { resetFixer } from './fixer';
import { route, send, start } from './server';

// Local protocol mocks for third-party services. Nothing here contacts a real provider.
route('GET', /^\/__health$/, (_request, response) => send(response, 200, { status: 'ok' }));
route('POST', /^\/__control\/reset$/, (_request, response) => { resetFixer(); send(response, 200, { status: 'reset' }); });
const port = Number(process.env.MOCK_PORT || 4010);
const server = start(port);
const stop = () => server.close(() => process.exit(0));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
console.log(`Mock services listening on ${port}`);
