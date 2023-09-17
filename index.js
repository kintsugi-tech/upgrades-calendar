const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');
const axios = require('axios');
const base32 = require('base32.js')

Date.prototype.addHours = function(h) {
  this.setTime(this.getTime() + (h*60*60*1000));
  return this;
}

// If modifying these scopes, delete token.json.
const SCOPES = ['https://www.googleapis.com/auth/calendar'];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

const CALENDAR_ID = 'c_feb4487007380c4df61e41df8dc9c7168ed21b305752891a55859bd633ebbbb9@group.calendar.google.com';

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  return client;
}

/**
 * Create Events for each cosmos upgrades
 * @param {google.auth.OAuth2} auth An authorized OAuth2 client.
 */
async function listEvents(auth) {
  const calendar = google.calendar({version: 'v3', auth});
  
  // Get created events
  let events = await calendar.events.list({
    calendarId: CALENDAR_ID,
  })

  const doneIds = events.data.items.map((e) => e.id)

  // Query upgrades
  let upgrades = await axios.get("https://polkachu.com/api/v1/chain_upgrades");

  upgrades.data.forEach(async (upgrade) => {

    // google api use a base32 implementation which is not very commont, allowing only a few characters to be used
    let utf8Encode = new TextEncoder();
    var encoder = new base32.Encoder({ type: "base32hex", lc: true });
    let id = encoder.write(utf8Encode.encode(`${upgrade.network}-${upgrade.block}`)).finalize();

    if (doneIds.indexOf(id) < 0) {

      let upgrade_start_time = new Date(upgrade.estimated_upgrade_time);
      let upgrade_end_time = new Date(upgrade.estimated_upgrade_time).addHours(1)

      const event = {
        'summary': `${upgrade.chain_name} ${upgrade.node_version} Upgrade`,
        'description': `${upgrade.chain_name} ${upgrade.node_version} Upgrade. Happening at block ${upgrade.block}. <a href="${upgrade.block_link}">Countdown</a>`,
        'start': {
          'dateTime': upgrade_start_time,
          'timeZone': 'UTC',
        },
        'end': {
          'dateTime': upgrade_end_time,
          'timeZone': 'UTC',
        },
        'id': `${id}`
      };

      calendar.events.insert({
        auth: auth,
        calendarId: CALENDAR_ID,
        resource: event,
      }, function(err, event) {
        if (err) {
          console.log('There was an error contacting the Calendar service: ' + err);
          return;
        }
        console.log('Event created: %s', JSON.stringify(event));
      });
    }
  })

}

authorize().then(listEvents).catch(console.error);
