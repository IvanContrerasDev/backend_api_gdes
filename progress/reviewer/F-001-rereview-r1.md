# Re-review package F-001 round 1 (00091bf..HEAD)

## Commits
6ed0ad1 chore: enforce no-explicit-any as error in ESLint (strict TypeScript)
014c066 fix: copy generated Prisma client from build stage in production image

## Diff
diff --git a/Dockerfile b/Dockerfile
index 6b9c285..e3f949d 100644
--- a/Dockerfile
+++ b/Dockerfile
@@ -18,14 +18,17 @@ ENV NODE_ENV=development
 COPY package.json package-lock.json ./
 RUN npm ci
 COPY . .
 RUN npx prisma generate && npm run build
 
 # ---- Production runtime ----
 FROM base AS production
 ENV NODE_ENV=production
 COPY package.json package-lock.json ./
 COPY prisma ./prisma
-RUN npm ci --omit=dev && npx prisma generate
+# prisma CLI is a devDependency, so no `prisma generate` here: the generated
+# client (pinned to the lockfile versions) is copied from the build stage.
+RUN npm ci --omit=dev
+COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
 COPY --from=build /app/dist ./dist
 EXPOSE 3000
 CMD ["node", "dist/main.js"]
diff --git a/eslint.config.mjs b/eslint.config.mjs
index 254e461..d034538 100644
--- a/eslint.config.mjs
+++ b/eslint.config.mjs
@@ -18,18 +18,18 @@ export default tseslint.config(
       },
       sourceType: 'commonjs',
       parserOptions: {
         projectService: true,
         tsconfigRootDir: import.meta.dirname,
       },
     },
   },
   {
     rules: {
-      '@typescript-eslint/no-explicit-any': 'warn',
+      '@typescript-eslint/no-explicit-any': 'error',
       '@typescript-eslint/no-unused-vars': [
         'error',
         { argsIgnorePattern: '^_' },
       ],
     },
   },
 );
