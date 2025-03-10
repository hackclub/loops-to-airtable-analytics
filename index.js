import dotenv from 'dotenv'
import Airtable from 'airtable'
import { LoopsClient } from 'loops'

import { downloadAudienceExport } from './loops'
import loadCsv from './loadCsv'
import { formatDate, isWithinPastNDays, anonymizeEmail, sha256, categorizeGenderOfName, geocodeAddress, determineBestKnownGender } from './util'

dotenv.config()

const airtableApiKey = process.env.AIRTABLE_API_KEY
const airtableBaseId = process.env.AIRTABLE_BASE_ID

const loopsSessionCookie = process.env.LOOPS_SESSION_COOKIE

const loopsCsvExportPath = 'tmp/loops_export.csv'

const loops = new LoopsClient(process.env.LOOPS_API_KEY)

await downloadAudienceExport(loopsSessionCookie, loopsCsvExportPath)

// process only the people who have lastEngagementAt in the past 365 days
const onlyLastYear = true

const truncateEmailsInLogs = true

if (!airtableApiKey) {
  console.error('AIRTABLE_API_KEY must be set')
  process.exit(1)
}

let base = new Airtable({ apiKey: airtableApiKey }).base(airtableBaseId)

let loopsData = await loadCsv(loopsCsvExportPath)

let airtableProgramNames = await new Promise((resolve, reject) => {
  let programs = {}

  base('Programs').select().eachPage(
    (records, nextPage) => {
      records.forEach(record => programs[record.id] = record.fields['Name'])

      nextPage()
    },
    err => {
      if (err) return reject(err)
      resolve(programs)
    }
  )
})

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

console.log('Checking field mappings:')

// only count timestamps that end with At (ex. attendedAt)
let mappedFieldNames = [...Object.keys(programMappingRules), ...Object.keys(fieldMappingRules)]

let unmappedTimestampFields = Object.keys(loopsData[0])
  .filter(x => x.endsWith('At'))
  .filter(x => !mappedFieldNames.includes(x))

unmappedTimestampFields.forEach(unmapped => {
  console.log(`  ${unmapped} is not mapped!`)
})

if (unmappedTimestampFields.length == 0) {
  console.log(` No unmapped fields!`)
}

console.log()

console.log(`Processing Loops export:`)

let updateQueue = []
let createQueue = []

for (let row of loopsData) {
  let emailToLog = truncateEmailsInLogs ? anonymizeEmail(row.email) : row.email
  console.log(`  ${emailToLog}`)

  if (row.email.endsWith('@hack.af')) {
    console.log("    Skipping because hack.af is a test email")
    continue
  }

  // geocode address if addressLine1 and addressCity are present
  if (row.addressLine1 && row.addressCity) {
    const addressString = `${row.addressLine1}
${row.addressLine2 || ''}
${row.addressCity}, ${row.addressState || ''} ${row.addressZipCode || ''}
${row.addressCountry || ''}`.trim()

    const addressHash = sha256(addressString)

    if (addressHash !== row.calculatedGeocodedHash) {
      const geocodeResult = await geocodeAddress(addressString)

      if (geocodeResult) {
        let fields = {
          calculatedGeocodedLongitude: geocodeResult.longitude,
          calculatedGeocodedLatitude: geocodeResult.latitude,
          calculatedGeocodedCountryName: geocodeResult.countryName,
          calculatedGeocodedCountryCode: geocodeResult.countryCode,
          calculatedGeocodedHash: addressHash
        }

        let resp = await loops.updateContact(row.email, fields)
        if (!resp.success) {
          console.error(resp.message)
          continue
        }

        row = {
          ...row,
          ...fields
        }

        console.log(`    Geocoded address for ${emailToLog}`)
      }
    }
  }

  // calculate gender based on their full name, using geocoded country code if available
  const fullName = [row.firstName, row.lastName].filter(Boolean).join(' ');
  if (fullName && sha256(fullName) != row.calculatedFullNameGenderHash) {
    let fields = {
      calculatedFirstNameGender: await categorizeGenderOfName(fullName, row.calculatedGeocodedCountryCode),
      calculatedFullNameGenderHash: sha256(fullName)
    }

    let resp = await loops.updateContact(row.email, fields)
    if (resp.error) {
      console.error(resp.error)
      continue
    }

    row = {
      ...row,
      ...fields
    }

    console.log(`    Categorized gender of name: ${fullName} -> ${fields.calculatedFirstNameGender}`)
  }

  let calculatedGenderBestKnownHash = sha256(`${row.calculatedFirstNameGender}${row.genderSelfReported}`)
  if ((row.calculatedFirstNameGender || row.genderSelfReported) && calculatedGenderBestKnownHash !== row.calculatedGenderBestKnownHash) {
    let gender = await determineBestKnownGender({
      firstNameGender: row.calculatedFirstNameGender,
      genderSelfReported: row.genderSelfReported
    })

    let fields = {
      calculatedGenderBestKnown: gender,
      calculatedGenderBestKnownHash: calculatedGenderBestKnownHash
    }

    let resp = await loops.updateContact(row.email, fields)
    if (resp.error) {
      console.error(resp.error)
      continue
    }

    row = {
      ...row,
      ...fields
    }

    console.log(`    Determined best known gender: ${fields.calculatedGenderBestKnown}`)
  }

  if (row.userGroup != 'Hack Clubber') {
    console.log("    Skipping because not Hack Clubber")
    continue
  }

  if (!row.subscribed) {
    console.log("    User is unsubscribed; checking if Airtable record exists to delete")

    // Check if Airtable record exists
    let airtableMatch = await new Promise((resolve, reject) => {
      base('Hack Clubbers').select({
        filterByFormula: `{${fieldMappingRules.email}} = '${row.email}'`
      }).firstPage((err, records) => {
        if (err) return reject(err)

        if (records.length === 0) {
          resolve(null)
        } else {
          const record = records[0]
          const match = {
            ...record.fields,
            createdTime: new Date(record._rawJson.createdTime),
            id: record.id
          }
          resolve(match)
        }
      })
    })

    if (airtableMatch) {
      // Delete the Airtable record
      await new Promise((resolve, reject) => {
        base('Hack Clubbers').destroy(airtableMatch.id, (err, deletedRecord) => {
          if (err) return reject(err)
          console.log(`    Deleted Airtable record for ${emailToLog}`)
          resolve()
        })
      })
    } else {
      console.log("    No Airtable record to delete")
    }

    continue
  }

  let airtableUpdates = {}
  let lastEngagementAt

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
          time: row[loopsField],
          programName: airtableProgramNames[programMappingRules[loopsField]]
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


  // this will check the ysws engagement name for this keyword, and consider
  // this a ysws 'approval' if this word is present in the engagement name
  //
  // this is to differentiate between 'bobaDropsSubmittedAt' and
  // 'bobaDropsApprovedAt'
  let yswsApprovedKeyword = 'approved'

  let yswsApprovals = engagements.filter(e => e.programName?.includes("YSWS") && e.name.toLowerCase().includes(yswsApprovedKeyword))

  if (engagements.length > 0) {
    let last = engagements[0]
    let first = engagements[engagements.length - 1]

    lastEngagementAt = last.time

    airtableUpdates['First Program'] = [programMappingRules[first.name]]

    airtableUpdates['Last Engagement At'] = lastEngagementAt
    airtableUpdates['Last Engagement'] = last.name

    airtableUpdates['First Engagement At'] = first.time
    airtableUpdates['First Engagement'] = first.name

    if (engagements.length > 1) {
      // find 2nd program they engaged in. ex. they start with Slack, then do YSWS
      let secondProgramFirstEngagement = engagements.reverse().find(e => e.programName !== first.programName)

      // this will be undefined if the hack clubber has multiple engagments, but
      // all within the same program. ex. they signed up for slack, then posted
      // in #ship
      if (secondProgramFirstEngagement) {
        airtableUpdates['Second Program'] = [programMappingRules[secondProgramFirstEngagement.name]]
      }
    }

    if (yswsApprovals.length > 0) {
      airtableUpdates['Last YSWS Approved At'] = yswsApprovals[0].time
      airtableUpdates['Last YSWS Approved'] = yswsApprovals[0].name
      airtableUpdates['YSWS Approved Count'] = yswsApprovals.length
    }

    airtableUpdates['Total Engagements'] = engagements.length

    airtableUpdates['Engagements Overview'] = engagements.map(e =>
      `${e.name} ${formatDate(e.time)}`
    ).join('\n')
  }

  // don't add the hack clubber to the airtable if they have 0 engagements to
  // save on records (50,000 limit per base)
  if (engagements.length == 0) {
    console.log("    Skipping because 0 engagements")
    continue
  }

  // skip records in past year if onlyLastYear is set
  if (onlyLastYear && !isWithinPastNDays(lastEngagementAt, 365)) {
    console.log("    Skipping because no engagements in past year")
    continue
  }

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
      base('Hack Clubbers').replace(updateQueue, (err, _) => {
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
    base('Hack Clubbers').replace(updateQueue, (err, _) => {
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