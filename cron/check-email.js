const { runCheckEmailJob } = require('../shared/checkEmailJob');

runCheckEmailJob()
  .then((result) => { console.log('Listo.', JSON.stringify({ ...result, log: undefined })); process.exit(0); })
  .catch(err => { console.error('Fallo el chequeo:', err); process.exit(1); });
