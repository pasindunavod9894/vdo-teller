# VDO Teller

Type a video topic and get a faceless, AI-made short-video series (short-story reels of 25 to 30 seconds) that is ready for Facebook and YouTube. Built with Next.js, Payload CMS, Postgres, OpenAI, fal.ai and FFmpeg.

## Local setup

1. `cp .env.example .env`, then fill in the keys you have (`OPENAI_API_KEY`, `FAL_KEY`) and choose a database password (it must be the same in `DATABASE_URL` and `POSTGRES_PASSWORD`). Without keys the app runs on free sample data and mock media.
2. `docker compose up -d` starts a local Postgres on port 5434 (see `docker-compose.yml`; the data lives in the `vdo-teller-pgdata` volume, so `docker compose down` keeps it).
3. `pnpm install && pnpm dev`, then open `http://localhost:3000`.
4. FFmpeg (with libass) must be installed on your machine; it does all the video assembling.

Useful scripts (the paid ones are a dry run unless you add `--yes`): `scripts/style-reel.ts` (a free mock reel in any style), `scripts/live-kling-test.ts`, `scripts/lipsync-proof.ts` and `scripts/story-eval.ts` (paid checks), and `scripts/migrate-formats.ts` (converts old series to the three reel lengths).

## How it works

The Payload config is tailored specifically to the needs of most websites. It is pre-configured in the following ways:

### Collections

See the [Collections](https://payloadcms.com/docs/configuration/collections) docs for details on how to extend this functionality.

- #### Users (Authentication)

  Users are auth-enabled collections that have access to the admin panel.

  For additional help, see the official [Auth Example](https://github.com/payloadcms/payload/tree/3.x/examples/auth) or the [Authentication](https://payloadcms.com/docs/authentication/overview#authentication-overview) docs.

- #### Media

  This is the uploads enabled collection. It features pre-configured sizes, focal point and manual resizing to help you manage your pictures.

## Questions

If you have any issues or questions, reach out to us on [Discord](https://discord.com/invite/payload) or start a [GitHub discussion](https://github.com/payloadcms/payload/discussions).
