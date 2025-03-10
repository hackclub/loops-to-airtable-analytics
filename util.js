import { generateObject } from 'ai'
import { openai } from '@ai-sdk/openai'
import { z } from 'zod'
import fetch from 'node-fetch';

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

export async function categorizeGenderOfName(name, countryCode = null) {
  const apiKey = process.env.GENDERIZE_API_KEY;
  const baseUrl = 'https://api.genderize.io';
  let url = apiKey ? 
    `${baseUrl}?name=${encodeURIComponent(name)}&apikey=${apiKey}` :
    `${baseUrl}?name=${encodeURIComponent(name)}`;
  
  if (countryCode) {
    url += `&country_id=${countryCode}`;
  }

  const response = await fetch(url);
  const data = await response.json();

  if (data.error) {
    throw new Error("Bad response from genderize.io: " + data.error);
  }

  if (data.gender === null) {
    return 'error';
  }

  // Genderize only returns 'male' or 'female', so we'll consider low probability
  // predictions as gender-neutral
  if (data.probability < 0.75) {
    return 'gender-neutral';
  }

  return data.gender;
}

export async function determineBestKnownGender({ firstNameGender, genderSelfReported }) {
  // if the given firstNameGender is "error" or "gender-neutral", our prompt
  // will incorrectly categorize the gender, so we'll use an empty string
  if (firstNameGender != 'male' && firstNameGender != 'female') {
    firstNameGender = ''
  }

  const options = [ 'male', 'female', 'nonbinary' ]
  const prompt = `
Categorize the user's gender into one of the following options: ${options.join(', ')}

User provided information (empty quotes indicate that the user didn't provide that information):

Self-reported gender: "${genderSelfReported}"
Gender of user's first name: "${firstNameGender}"

Instructions:

1. If the user self-reported their gender, use this. Self-reported gender always takes precedent over gender of first name.
2. If the user didn't self-report their gender, use the gender of their first name
`

  const { object } = await generateObject({
    model: openai('gpt-4o'),
    schema: z.object({
      gender: z.enum(['male', 'female', 'nonbinary']),
      unableToCategorizeGenderWithGivenInformation: z.boolean()
    }),
    prompt
  })

  if (object.unableToCategorizeGenderWithGivenInformation) {
    return null
  }

  return object.gender
}

export function sha256(string) {
  return crypto.createHash('sha256').update(string).digest('hex');
}

export async function geocodeAddress(address) {
  const apiKey = process.env.GOOGLE_MAPS_API_KEY;
  const encodedAddress = encodeURIComponent(address);
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodedAddress}&key=${apiKey}`;

  try {
    const response = await fetch(url);
    const data = await response.json();

    if (data.status !== 'OK') {
      throw new Error(`Geocoding error: ${data.status}`);
    }

    const result = data.results[0];
    const location = result.geometry.location;
    const countryComponent = result.address_components.find(component =>
      component.types.includes('country')
    );

    return {
      longitude: location.lng,
      latitude: location.lat,
      countryName: countryComponent ? countryComponent.long_name : null,
      countryCode: countryComponent ? countryComponent.short_name : null,
      rawJson: {
        provider: 'Google Maps',
        geocodedAt: new Date().toISOString(),
        rawGeocodeResult: result
      }
    };
  } catch (error) {
    console.error('Error geocoding address:', error);
    return null;
  }
}
