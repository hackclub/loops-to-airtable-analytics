import dotenv from 'dotenv'
import Airtable from 'airtable'

import loadCsv from './loadCsv'

dotenv.config()

const airtableApiKey = process.env.AIRTABLE_API_KEY
const airtableBaseId = process.env.AIRTABLE_BASE_ID

const loopsCsvExportPath = 'dev_files/loops_export.csv'

if (!airtableApiKey) {
  console.error('AIRTABLE_API_KEY must be set')
  process.exit(1)
}

let base = new Airtable({ apiKey: airtableApiKey }).base(airtableBaseId)

let loopsData = await loadCsv(loopsCsvExportPath)

let airtableProgramMappingRules = await new Promise((resolve, reject) => {
  let rules = []

  base('Program Mapping Rules').select().eachPage(
    (records, nextPage) => {
      records.forEach(record => rules.push(record.fields))

      nextPage()
    },
    err => {
      if (err) return reject(err)
      resolve(rules)
    }
  )
})

let airtableFieldMappingRules = await new Promise((resolve, reject) => {
  let rules = []

  base('Field Mapping Rules').select().eachPage(
    (records, nextPage) => {
      records.forEach(record => rules.push(record.fields))
      nextPage()
    },
    err => {
      if (err) return reject(err)
      resolve(rules)
    }
  )
})

let programMappingRules = airtableProgramMappingRules.map(rawRule => {
  let rule = {}
  rule[rawRule['Loops.so Field To Map']] = rawRule['Program'][0]
  return rule
})

let fieldMappingRules = airtableFieldMappingRules.map(rawRule => {
  let rule = {}
  rule[rawRule['Loops.so Field To Map']] = rawRule['Hack Clubber Field']
  return rule
})

console.log(fieldMappingRules)