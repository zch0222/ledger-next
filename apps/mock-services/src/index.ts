import { resetChannels, startSmtp } from './channels';
import { resetFixer } from './fixer';
import { route, send, start } from './server';

// Local protocol mocks for third-party services (FX, notification channels, SMTP). Nothing here contacts a real
// provider; tests read the inboxes as independent evidence that a message arrived.
route('GET', /^\/__health$/, (_request, response) => send(response, 200, { status: 'ok' }));
route('POST', /^\/__control\/reset$/, (_request, response) => {
  resetFixer();
  resetChannels();
  send(response, 200, { status: 'reset' });
});
const port = Number(process.env.MOCK_PORT || 4010);
const smtpPort = Number(process.env.MOCK_SMTP_PORT || 2525);
const server = start(port);
const smtp = startSmtp(smtpPort);
const stop = () => {
  smtp.close();
  server.close(() => process.exit(0));
};
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
console.log(`Mock services listening on ${port} (HTTP) and ${smtpPort} (SMTP)`);
