---
name: 11mirror-graph-reasoning
version: 1.0.0
description: |
  Graph reasoning decision protocol for 11Mirror agents. Teaches when to use
  knowledge graph queries (via Cognee/TrustGraph) vs brain search (via fbrain).
  Route relationship questions to the graph engine; route content retrieval to
  brain search first.
triggers:
  - "relationship"
  - "entity connections"
  - "who is connected to"
  - "trace"
  - "provenance"
  - "how is X related to Y"
  - "dependencies between"
  - "what depends on"
  - "approval chain"
  - "connected entities"
tools:
  - graph_query
  - entity_search
  - search
  - get_page
  - traverse_graph
  - get_backlinks
mutating: false
---

# Graph Reasoning — When to use the Knowledge Graph

When an agent needs to understand RELATIONSHIPS between entities (people, vendors, cost centers, documents), route to the graph engine. For direct content retrieval, use brain search first.

## Decision Protocol

1. **First: ALWAYS try fbrain `search`** (fast, <1s, hybrid vector+keyword)
   - Works for: "find me X", "what is X", "show me the doc about X"

2. **Then: If the question is about CONNECTIONS, use `graph_query`** (5-20s, uses LLM)
   - Works for: "how is X connected to Y?", "what depends on X?", "trace the approval chain"
   - Works for: "show all entities related to cost center CC-4401"
   - Works for: "what is the provenance of this EBITDA number?"

3. **Never skip brain search.** Even for graph questions, brain search gives context.

## Tools

| Tool | When | Latency | Cost |
|------|------|---------|------|
| `search` | Any content question | <1s | Free (no LLM) |
| `query` | Semantic + keyword hybrid | <1s | Free (no LLM) |
| `graph_query` | Entity relationships, multi-hop | 5-20s | ~$0.005 (LLM synthesis) |
| `entity_search` | Find specific entities in graph | 3-10s | ~$0.003 |
| `get_page` | Read full document | <1s | Free |
| `traverse_graph` | Walk typed edges from a node | <1s | Free (no LLM) |
| `get_backlinks` | Find pages linking to a slug | <1s | Free |

## Rules

- NEVER call graph_query for simple "find me" questions (waste of tokens)
- ALWAYS cite the source entity/page in your answer
- If graph_query returns empty, fall back to brain search results
- If both return empty, say "I don't have information about this"
- Prefer `traverse_graph` over `graph_query` when you already know the starting entity slug
- Use `get_backlinks` to discover reverse relationships cheaply before escalating to graph_query

## Routing Examples

### Use brain search (fast path)
- "What is Project Aurora?" -> `search("Project Aurora")`
- "Show me the Q3 board deck" -> `search("Q3 board deck")`
- "What did Alice say about hiring?" -> `search("Alice hiring")`

### Use graph query (relationship path)
- "How is Alice connected to Project Aurora?" -> `search("Alice")` then `graph_query`
- "What depends on vendor Acme Corp?" -> `search("Acme Corp")` then `graph_query`
- "Trace the approval chain for this budget" -> `search("budget")` then `graph_query`
- "Show all entities related to cost center CC-4401" -> `entity_search("CC-4401")` then `graph_query`

### Use traverse_graph (known entity path)
- "Who does Alice work with?" -> `traverse_graph(slug="people/alice", type="works_with")`
- "What companies has Fund A invested in?" -> `traverse_graph(slug="funds/fund-a", type="invested_in")`

## Contract

This skill guarantees:
- Brain search is attempted before any graph query
- Every answer includes source attribution (page slug or entity ID)
- Graph queries are only used when relationship/connection semantics are needed
- Latency and cost are minimized by routing to the cheapest sufficient tool
