/**
 * MCPSession (native host) - the shared session from ../../mcp/session/MCPSession, identifying
 * itself to servers as the mobile host app. Handshake, tool/resource calls, allowlist and
 * result capping are all inherited; only the `clientInfo` sent in `initialize` differs.
 */
import { MCPSession as BaseMCPSession } from '../../mcp/session/MCPSession'
import type { IMCPTransport } from '../../mcp/transport/IMCPTransport'
import type { MCPSessionConfig } from '../../mcp/types'

export class MCPSession extends BaseMCPSession {
	constructor(transport: IMCPTransport, config: MCPSessionConfig) {
		super(transport, config, { name: 'GuideAxon', version: '1.0' })
	}
}
