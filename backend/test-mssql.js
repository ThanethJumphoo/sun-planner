const sql = require('mssql');
const config = {
  user: 'sa',
  password: 'Your_password123',
  server: 'localhost',
  database: 'sun_planner',
  options: {
    encrypt: false,
    trustServerCertificate: true
  }
};
sql.connect(config).then(pool => {
  return pool.request().query("SELECT ERP_ITEM_CODE, ICUT_SPEED FROM product_specs WHERE ERP_ITEM_CODE = '111117249'");
}).then(result => {
  console.log(result.recordset);
  process.exit(0);
}).catch(err => {
  console.error(err);
  process.exit(1);
});
