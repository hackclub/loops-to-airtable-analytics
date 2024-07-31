import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'

const https = require('https')
const fs = require('fs')
const crypto = require('crypto')

// thank you to chatgpt for writing functions in this file

export function formatDate(date) {
  let year = date.getFullYear();
  let month = date.getMonth() + 1;  // Months are zero-indexed in JavaScript
  let day = date.getDate();

  // Pad single digit month and day values with a leading zero
  month = month < 10 ? '0' + month : month;
  day = day < 10 ? '0' + day : day;

  return `${year}-${month}-${day}`;
}

export function isWithinPastNDays(date, n) {
  const nDaysAgo = new Date();
  nDaysAgo.setDate(nDaysAgo.getDate() - n);  // Subtract n days from the current date

  return date >= nDaysAgo;
}

// zach@hackclub.com => zac*@hac*****.com
export function anonymizeEmail(email) {
  let [localPart, domain] = email.split('@');
  let [baseDomain, tld] = domain.split('.');

  localPart = localPart.length > 3 ? localPart.slice(0, 3) + '*'.repeat(localPart.length - 3) : localPart;
  domain = baseDomain.length > 3 ? baseDomain.slice(0, 3) + '*'.repeat(baseDomain.length - 3) : baseDomain;

  return `${localPart}@${domain}.${tld}`;
}

// wait the specified number of seconds
export async function wait(seconds) {
  return new Promise(resolve => setTimeout(resolve, seconds * 1000));
}

export async function downloadFile(url, destPath) {
  const file = fs.createWriteStream(destPath);

  return new Promise((resolve, reject) => {
    https.get(url, response => {
      response.pipe(file);

      file.on('finish', () => {
        file.close(resolve);
      });
    }).on('error', error => {
      fs.unlink(destPath);
      reject(error);
    });
  });
}

export async function categorizeGenderOfName(name) {
  const options = [
    'male',
    'female',
    'gender-neutral',
    'error'
  ]

  const { object } = await generateObject({
    model: openai('gpt-4o-mini'),
    schema: z.object({
      gender: z.string()
    }),
    prompt: `Classify the gender of a given name. Name: '${name}'. Must be one of ${JSON.stringify(options)}`,
  })

  if (!options.includes(object.gender))
    return categorizeGenderOfName(name)

  return object.gender
}

export function sha256(string) {
  return crypto.createHash('sha256').update(string).digest('hex');
}
