# Release runbook

The full version of this, with the account steps, lives as a doc:
https://claude.ai/artifact/UfqZGoTuNuLSJW1fS4hFoZ

## The short version

Release:

    git tag v1.0.1 && git push origin v1.0.1

That builds the Android bundle and the iOS build and uploads them to Play internal
testing and TestFlight. Both arrive as drafts; nothing reaches anyone until it is
promoted in the console.

## The secrets the pipeline needs

Android (GitHub → Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `ANDROID_KEYSTORE_BASE64` | the upload keystore, base64 |
| `ANDROID_KEYSTORE_PASSWORD` | its password |
| `ANDROID_KEY_ALIAS` | `worldmapper` |
| `ANDROID_KEY_PASSWORD` | the key password |
| `PLAY_SERVICE_ACCOUNT_JSON` | the Play service-account JSON, whole |

Apple:

| Secret | Value |
| --- | --- |
| `APP_STORE_CONNECT_API_KEY` | the .p8 key, base64 |
| `APP_STORE_CONNECT_KEY_ID` | key id |
| `APP_STORE_CONNECT_ISSUER_ID` | issuer id |
| `IOS_TEAM_ID` | team id |
| `MATCH_GIT_URL` | the private certificates repo |
| `MATCH_GIT_TOKEN` | a fine-grained PAT for that repo |
| `MATCH_PASSWORD` | the passphrase encrypting the stored certificate |

Either half is skipped, with a warning, when its secrets are absent, so one store can
be set up before the other.

## First Android release only

Google refuses API uploads until one build has gone in through the console. Download
the `.aab` from the workflow run's artifacts and upload it by hand once, under
Testing → Internal testing.
