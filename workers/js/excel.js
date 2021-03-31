const Excel = require('exceljs');
const tmp = require('tmp');
const fs = require('fs');

async function excelCreate (service, sheets, data)
{
  var tmpfile = tmp.fileSync({ mode: 0o644, postfix: '.xlsx' });
  const options = {
    filename: tmpfile.name,
    useStyles: true,
    useSharedStrings: true
  };
  const workbook = new Excel.stream.xlsx.WorkbookWriter(options);
  for (var i=0; i<sheets.length; i++) {
    var worksheet = workbook.addWorksheet(sheets[i]);
    worksheet.state = 'visible';

    var sheetData = data[i];
    // Get sheet data from redis cache
    if (typeof sheetData == 'string' && sheetData.startsWith('redis')) {
      var key = sheetData.substring(6);
      var redisData = await service.redis.getAsync (key);
      sheetData = JSON.parse (redisData);
    }

    var sheetColumns = [];
    for (var j=0; j<sheetData.length; j++) {
      if (j == 0) {
        for (let [key] of Object.entries(sheetData[j])) {
          sheetColumns.push ({header: key, key: key, width: 20});
        }
      }
    }
    worksheet.columns = sheetColumns;

    for (j=0; j<sheetData.length; j++) {
      worksheet.addRow(sheetData[j]).commit();
    }
    worksheet.commit();
  }

  await workbook.commit();
  var exceldata = fs.readFileSync(options.filename);
  fs.unlinkSync(options.filename);
  return Buffer.from(exceldata).toString('base64');
}

module.exports = { excelCreate };
