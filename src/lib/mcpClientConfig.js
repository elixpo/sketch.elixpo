function requireConfigValue(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} is required`)
  return value.trim()
}

function normalizedRemoteOrigin(origin) {
  const parsed = new URL(requireConfigValue(origin, 'Remote URL'))
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('Remote URL must use HTTP or HTTPS')
  return parsed.origin
}

export function createMcpClientDefinition({ origin, sessionId, token, encryptionKey }) {
  return {
    command: 'npx',
    args: [
      '-y',
      '@elixpo/lixsketch@latest',
      '--remote',
      normalizedRemoteOrigin(origin),
      '--workspace',
      requireConfigValue(sessionId, 'Workspace ID'),
    ],
    env: {
      LIXSKETCH_AGENT_TOKEN: requireConfigValue(token, 'Agent token'),
      LIXSKETCH_ENCRYPTION_KEY: requireConfigValue(encryptionKey, 'Encryption key'),
    },
  }
}

export function createMcpJsonConfig(options) {
  return `${JSON.stringify({ mcpServers: { lixsketch: createMcpClientDefinition(options) } }, null, 2)}\n`
}

function tomlString(value) {
  return JSON.stringify(value)
}

export function createCodexTomlConfig(options) {
  const definition = createMcpClientDefinition(options)
  return [
    '[mcp_servers.lixsketch]',
    `command = ${tomlString(definition.command)}`,
    `args = [${definition.args.map(tomlString).join(', ')}]`,
    '',
    '[mcp_servers.lixsketch.env]',
    `LIXSKETCH_AGENT_TOKEN = ${tomlString(definition.env.LIXSKETCH_AGENT_TOKEN)}`,
    `LIXSKETCH_ENCRYPTION_KEY = ${tomlString(definition.env.LIXSKETCH_ENCRYPTION_KEY)}`,
    '',
  ].join('\n')
}

export function codexConfigFromMcpJson(jsonConfig) {
  const parsed = JSON.parse(jsonConfig)
  const definition = parsed?.mcpServers?.lixsketch
  if (!definition?.command || !Array.isArray(definition.args) || !definition?.env) {
    throw new Error('Saved MCP configuration is invalid')
  }
  return [
    '[mcp_servers.lixsketch]',
    `command = ${tomlString(definition.command)}`,
    `args = [${definition.args.map(tomlString).join(', ')}]`,
    '',
    '[mcp_servers.lixsketch.env]',
    `LIXSKETCH_AGENT_TOKEN = ${tomlString(definition.env.LIXSKETCH_AGENT_TOKEN)}`,
    `LIXSKETCH_ENCRYPTION_KEY = ${tomlString(definition.env.LIXSKETCH_ENCRYPTION_KEY)}`,
    '',
  ].join('\n')
}
