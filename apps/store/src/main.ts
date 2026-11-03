import { createStoreServer } from './server.js';

const port = Number(process.env.PORT ?? 8080);
const app = createStoreServer();
app.listen({ port, host: '0.0.0.0' }).then((addr) => {
  console.log(`Kaffeebohne Roasters listening on ${addr}`);
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
