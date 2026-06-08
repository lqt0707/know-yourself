async function jinaEmbed(text: string, task: 'retrieval.passage' | 'retrieval.query'): Promise<number[]> {
  const response = await fetch('https://api.jina.ai/v1/embeddings', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${process.env.JINA_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'jina-embeddings-v3',
      input: [text.slice(0, task === 'retrieval.query' ? 2000 : 8000)],
      task,
    }),
  })

  if (!response.ok) {
    throw new Error(`Jina embedding failed: ${response.status} ${await response.text()}`)
  }

  const data = await response.json() as { data: Array<{ embedding: number[] }> }
  return data.data[0].embedding
}

// 存储侧：对摘要文本生成向量
export function generateEmbedding(text: string): Promise<number[]> {
  return jinaEmbed(text, 'retrieval.passage')
}

// 查询侧：对用户消息生成向量（用于语义检索）
export function generateQueryEmbedding(text: string): Promise<number[]> {
  return jinaEmbed(text, 'retrieval.query')
}
