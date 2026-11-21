# The Recall API for Cloud Run (role: api — prefetch stays off by design).
#
# Two stages so the image ships without the TypeScript compiler or dev
# dependencies. `slim` rather than `alpine`: argon2 ships prebuilt bindings
# for glibc, and alpine's musl would force a native compile on every build.

FROM node:22-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src ./src
# `npm run build` compiles AND carries src/templates into dist (M241).
# The step lives in build/, not scripts/: .gcloudignore and .dockerignore
# let in only what this file COPYs, and scripts/ is not on that list on
# purpose — those are operator seeders the image must never carry — so a
# build step hidden in there is a build step Cloud Build cannot see.
# The build script refuses to finish if no template lands, which is how
# this missing COPY was caught rather than shipping a route that throws
# ENOENT the first time the owner presses Export.
COPY build ./build
RUN npm run build

FROM node:22-slim
WORKDIR /app
ENV NODE_ENV=production
# One proxy — Cloud Run's front end — stands between the internet and this
# process. The rate limiters key on req.ip, and with 0 every visitor wears the
# proxy's address and shares one bucket. It used to live only in the Cloud Run
# console; here it travels with the image, and env.ts refuses to start a
# production api without it, so a console slip cannot quietly reset it.
ENV TRUST_PROXY_HOPS=1
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist

# Cloud Run injects PORT; env.ts reads it. Uploads land in .cache/uploads
# under cwd — tmpfs on Cloud Run, which is why the service runs with 1GiB.
EXPOSE 8080
CMD ["node", "dist/server.js"]
