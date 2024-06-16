import { wait, downloadFile } from './util'

export async function downloadAudienceExport(sessionCookie, destPath) {
  console.log("Begin export from Loops")

  let resp = await fetch("https://app.loops.so/api/trpc/lists.exportContacts", {
    "headers": {
      "content-type": "application/json",
      "cookie": sessionCookie,
    },
    "body": JSON.stringify({
      json: {
        filter: null,
        mailingListId: ""
      }
    }),
    "method": "POST"
  })

  let json = await resp.json()

  // sample format:
  //
  // {"json":{"id":"XXXXX","createdAt":"2024-05-21T13:33:44.682Z","updatedAt":"2024-05-21T13:33:44.682Z","teamId":"XXXX","userId":"XXXX","status":"Pending","downloadUrl":null,"redisId":null,"audienceFilter":null}
  let audienceExport = json.result.data

  // check on export status
  let exportReq = {
    json: {
      id: audienceExport.json.id
    }
  }

  let urlInput = encodeURIComponent(JSON.stringify(exportReq))

  let fileReadyStatus

  while (fileReadyStatus != 'Complete') {
    await wait(5)

    console.log("Waiting for Loops export to complete")

    resp = await fetch(`https://app.loops.so/api/trpc/audienceDownload.getAudienceDownload?input=${urlInput}`, {
      "headers": {
        "content-type": "application/json",
        "cookie": sessionCookie
      }
    })

    json = await resp.json()

    // this will set to 'Complete' when the file is ready to download
    fileReadyStatus = json.result.data.json.status
  }

  console.log("Get presigned download URL")

  resp = await fetch("https://app.loops.so/api/trpc/audienceDownload.signs3Url", {
    "headers": {
      "content-type": "application/json",
      "cookie": sessionCookie,
    },
    "body": JSON.stringify(exportReq),
    "method": "POST"
  })

  json = await resp.json()

  let downloadUrl = json.result.data.json.presignedUrl

  console.log('Download file to filesystem')

  await downloadFile(downloadUrl, destPath)

  return true
}