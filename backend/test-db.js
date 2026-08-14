const { DataSource } = require('typeorm');
const ds = new DataSource({
  type: 'mssql',
  host: 'localhost',
  port: 1433,
  username: 'sa',
  password: 'YourStrongPassword1!',
  database: 'sun_planner',
  trustServerCertificate: true
});
ds.initialize()
  .then(() => ds.query("SELECT ERP_ITEM_CODE, ERP_ITEM_DESC, ICUT_SPEED FROM product_specs WHERE ERP_ITEM_CODE = '111117249'"))
  .then(console.log)
  .catch(console.error)
  .finally(() => ds.destroy());
