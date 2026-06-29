# 1. Build Stage
FROM node:22-alpine AS build

# Set the working directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the application code
COPY . .

# Build the React/Vite app
RUN npm run build

# 2. Serve Stage
FROM node:22-alpine

# Set the working directory
WORKDIR /app

# Install the 'serve' package globally to serve static files
RUN npm install -g serve

# Copy the built assets from the previous stage
COPY --from=build /app/dist ./dist

# Render automatically sets the PORT environment variable.
# We'll default to 10000 if it's not set.
ENV PORT=10000

# Expose the port
EXPOSE ${PORT}

# Start the server, listening on the PORT provided by Render
CMD ["sh", "-c", "serve -s dist -l ${PORT:-10000}"]
