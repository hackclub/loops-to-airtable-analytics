import fs from 'fs'
import { parse } from 'fast-csv'

// only try to convert these fields into numbers
//
// TODO: really this should be done by downloading the schema of airtable,
// figuring out the field types, and doing typecasting where necessary in the
// main app logic
const numberOverrides = [
  'slackShipCount',
  'slackScrapbookCount',
  'calculatedGeocodedLongitude',
  'calculatedGeocodedLatitude',
  'calculatedYswsWeightedGrantContribution'
]

export default async function loadCSV(filePath) {
  let results = []

  return new Promise((resolve, reject) => {
    fs.createReadStream(filePath)
      .pipe(parse({ headers: true }))
      .transform(row => {
        // check each string field to see if it starts with XXXX-XX-XX, meaning
        // it's a date. if it's a date, then parse and convert into date.
        //
        // also convert numbers to numbers, and bools to bools
        for (let key in row) {
          if (typeof row[key] !== 'string') {
            continue
          }

          // check if bool, if so convert to bool and stop
          if (row[key].toLowerCase() == 'true') {
            row[key] = true
            continue
          } else if (row[key].toLowerCase() == 'false') {
            row[key] = false
            continue
          }

          // check if number, if so convert to number and stop
          if (numberOverrides.includes(key) && !isNaN(Number(row[key]))) {
            row[key] = Number(row[key])
            continue
          }

          // get the XXXX-XX-XX part and check lengths
          let firstTenChars = row[key].substring(0, 10)
          let parts = firstTenChars.split('-')

          if (parts.length != 3) continue
          if (parts[0].length != 4) continue
          if (parts[1].length != 2) continue
          if (parts[2].length != 2) continue

          let date = new Date(row[key])

          // check if date is invalid before setting it
          if (isNaN(date.getTime())) continue

          row[key] = date
        }

        return row
      })
      .on('data', (data) => results.push(data))
      .on('end', () => resolve(results))
      .on('error', (error) => reject(error))
  })
}