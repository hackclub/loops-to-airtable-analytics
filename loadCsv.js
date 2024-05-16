import fs from 'fs'
import { parse } from 'fast-csv'

export default async function loadCSV(filePath) {
  let results = []

  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(parse({ headers: true }))
      .transform(row => {
        // check each string field to see if it starts with XXXX-XX-XX, meaning
        // it's a date. if it's a date, then parse and convert into date.
        for (let key in row) {
          if (typeof row[key] !== 'string') {
            continue
          }

          // get the XXXX-XX-XX part and check lengths
          let firstTenChars = row[key].substring(0, 10)
          let parts = firstTenChars.split('-')

          if (parts.length != 3) continue
          if (parts[0].length != 4) continue
          if (parts[1].length != 2) continue
          if (parts[2].length != 2) continue

          row[key] = new Date(row[key])
        }

        return row
      })
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (error) => reject(error))
  })
}