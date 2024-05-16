import dotenv from 'dotenv'
import Airtable from 'airtable'

import loadCsv from './loadCsv'
import { formatDate } from './util'

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

let programMappingRules = {}
airtableProgramMappingRules.forEach(rawRule => {
  programMappingRules[rawRule['Loops.so Field To Map']] = rawRule['Program'][0]
})

let fieldMappingRules = {}
airtableFieldMappingRules.forEach(rawRule => {
  fieldMappingRules[rawRule['Loops.so Field To Map']] = rawRule['Hack Clubber Field']
})

console.log(`Processing Loops export:`)

let updateQueue = []
let createQueue = []

for (let row of loopsData.reverse()) {
  console.log(`  ${row.email}`)

  if (row.userGroup != 'Hack Clubber') {
    console.log("    Skipping because not Hack Clubber")
    continue
  }

  let airtableUpdates = {}
  let lastEngagementAt
  let lastEngagement
  let firstEngagement
  let totalEngagements = 0
  let engagementsOverviewData = {}

  let engagements = []

  for (let loopsField in fieldMappingRules) {
    let airtableField = fieldMappingRules[loopsField]

    if (row[loopsField]) {
      airtableUpdates[airtableField] = row[loopsField]
    }
  }

  airtableUpdates['Programs'] = []

  for (let loopsField in programMappingRules) {
    let airtableProgramId = programMappingRules[loopsField]

    if (row[loopsField] && row[loopsField] != "") {
      // if it's a date, then add it our engagements list (excludes Slack ID, for example)
      if (row[loopsField] instanceof Date) {
        engagements.push({
          name: loopsField,
          time: row[loopsField]
        })
      }

      // add to Programs if it's not already there
      if (!airtableUpdates['Programs'].includes(airtableProgramId)) {
        airtableUpdates['Programs'].push(airtableProgramId)
      }
    }
  }

  // sort engagements before adding them to airtableUpdates, from most recent to
  // earliest
  engagements = engagements.sort((a, b) => b.time - a.time)

  if (engagements.length > 0) {
    let last = engagements[0]
    let first = engagements[engagements.length - 1]

    airtableUpdates['Last Engagement At'] = last.time
    airtableUpdates['Last Engagement'] = last.name

    airtableUpdates['First Engagement'] = first.name

    airtableUpdates['Total Engagements'] = engagements.length

    airtableUpdates['Engagements Overview'] = engagements.map(e =>
      `${e.name} ${formatDate(e.time)}`
    ).join('\n')
  }

  // don't add the hack clubber to the airtable if they have 0 engagements to
  // save on records (50,000 limit per base)
  if (engagements.length == 0) continue

  let airtableMatch = await new Promise((resolve, reject) => {
    base('Hack Clubbers').select({
      filterByFormula: `{${fieldMappingRules.email}} = '${row.email}'`
    }).firstPage((err, records) => {
      if (err) return reject(err)

      if (records.length == 0) {
        resolve(null)
      } else {
        let match = records[0].fields
        match.createdTime = new Date(records[0]._rawJson.createdTime)
        match.id = records[0].id

        resolve(match)
      }
    })
  })

  // convert dates back to strings before sending to airtable
  for (let key in airtableUpdates) {
    let val = airtableUpdates[key]

    if (val instanceof Date) {
      airtableUpdates[key] = val.toISOString()
    }
  }

  if (airtableMatch) {
    updateQueue.push({
      id: airtableMatch.id,
      fields: airtableUpdates
    })
  } else {
    createQueue.push({
      fields: airtableUpdates
    })
  }

  if (updateQueue.length == 10) {
    await new Promise((resolve, reject) => {
      base('Hack Clubbers').update(updateQueue, (err, _) => {
        if (err) reject(err)
        resolve()
      })
    })

    updateQueue = []
  }

  if (createQueue.length == 10) {
    await new Promise((resolve, reject) => {
      base('Hack Clubbers').create(createQueue, (err, _) => {
        if (err) reject(err)
        resolve()
      })
    })

    createQueue = []
  }
}

if (updateQueue.length > 0) {
  await new Promise((resolve, reject) => {
    base('Hack Clubbers').update(updateQueue, (err, _) => {
      if (err) reject(err)
      resolve()
    })
  })

  updateQueue = []
}

if (createQueue.length > 0) {
  await new Promise((resolve, reject) => {
    base('Hack Clubbers').create(createQueue, (err, _) => {
      if (err) reject(err)
      resolve()
    })
  })

  createQueue = []
}