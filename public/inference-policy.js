(() => {
  const THINK_TAGS = [
    { open: '<think>', close: '</think>' },
    { open: '<thought>', close: '</thought>' },
  ];

  function detectModelPolicy(modelName = '') {
    const value = String(modelName || '').toLowerCase();
    const isGemma = value.includes('gemma');
    const isSmallGemma = isGemma && /(^|[^0-9])(2b|4b)([^0-9]|$)/i.test(value);
    return {
      family: isGemma ? 'gemma' : 'generic',
      tier: isSmallGemma ? 'small_structured' : (isGemma ? 'large_reasoning' : 'generic_fallback'),
      prefersXml: true,
      includeThought: true,
      fewShotExamples: isSmallGemma ? 3 : 0,
      strictTools: isSmallGemma,
      criticEnabled: true,
    };
  }

  function xmlEscape(text) {
    return String(text ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;');
  }

  function xmlSection(tag, value) {
    const content = String(value ?? '').trim();
    if (!content) return '';
    return `<${tag}>\n${content}\n</${tag}>`;
  }

  function normalizeExamples(examples = []) {
    return examples.map((example, index) => [
      `<example index="${index + 1}">`,
      xmlSection('input', xmlEscape(example.input ?? '')),
      xmlSection('thought', xmlEscape(example.thought ?? '')),
      xmlSection('output', xmlEscape(example.output ?? '')),
      '</example>',
    ].filter(Boolean).join('\n'));
  }

  function buildWorkflowMessages({
    modelName = '',
    workflow = 'generic',
    role = 'You are an AI assistant.',
    instructions = [],
    context = {},
    input = '',
    outputFormat = '',
    tools = [],
    examples = [],
    includeThought,
  }) {
    const policy = detectModelPolicy(modelName);
    const wantsThought = includeThought ?? policy.includeThought;
    const normalizedInstructions = [
      ...instructions,
      wantsThought
        ? 'Think through the task inside <thought> tags before the final answer. Keep the final answer outside <thought> tags.'
        : 'Return only the final answer.',
      outputFormat ? `Follow this output contract exactly: ${outputFormat}` : '',
    ].filter(Boolean);

    const contextSections = Object.entries(context)
      .map(([key, value]) => xmlSection(key, xmlEscape(value)))
      .filter(Boolean)
      .join('\n');

    const exampleBlock = policy.fewShotExamples > 0 && examples.length > 0
      ? xmlSection('few_shot_examples', normalizeExamples(examples.slice(0, policy.fewShotExamples)))
      : '';

    const toolBlock = tools.length > 0
      ? xmlSection('available_tools', xmlEscape(JSON.stringify(tools, null, 2)))
      : '';

    const system = [
      xmlSection('workflow', workflow),
      xmlSection('system_instruction', xmlEscape(role)),
      xmlSection('execution_rules', xmlEscape(normalizedInstructions.join('\n'))),
      policy.strictTools && tools.length > 0
        ? xmlSection('tool_call_rules', xmlEscape('If you use a tool, keep arguments explicit and schema-adherent.'))
        : '',
      exampleBlock,
      toolBlock,
    ].filter(Boolean).join('\n\n');

    const user = [
      contextSections,
      xmlSection('input_data', xmlEscape(input)),
      outputFormat ? xmlSection('output_format', xmlEscape(outputFormat)) : '',
    ].filter(Boolean).join('\n\n');

    return {
      policy,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: user },
      ],
    };
  }

  function buildCriticMessages({
    modelName = '',
    workflow = 'generic',
    originalMessages = [],
    draft = '',
    validationHint = '',
  }) {
    const critic = buildWorkflowMessages({
      modelName,
      workflow: `${workflow}_critic`,
      role: 'You are a rigorous reviewer for Gemma/Ollama outputs.',
      instructions: [
        'Review the draft for accuracy and adherence to the constraints.',
        'If the draft is valid, return a corrected but equivalent final answer.',
        'If the draft is invalid, return a corrected final answer that satisfies the constraints.',
      ],
      context: {
        original_request: originalMessages.map(message => `${message.role.toUpperCase()}:\n${message.content}`).join('\n\n---\n\n'),
      },
      input: draft,
      outputFormat: validationHint || 'Return only the corrected final answer.',
      includeThought: true,
    });
    return critic.messages;
  }

  function parseStructuredResponse(text = '') {
    let answer = String(text ?? '');
    let thought = '';
    for (const tag of THINK_TAGS) {
      const pattern = new RegExp(`${tag.open.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}([\\s\\S]*?)${tag.close.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`, 'gi');
      answer = answer.replace(pattern, (_, inner) => {
        thought += `${inner.trim()}\n`;
        return '';
      });
    }
    return {
      thought: thought.trim(),
      answer: answer.trim(),
    };
  }

  function buildFacilitatorToolSchema() {
    return [
      {
        name: 'select_next_participant',
        description: 'Choose the next participant and prompt for the meeting.',
        parameters: {
          participant_name: 'string',
          prompt: 'string',
        },
      },
    ];
  }

  const api = {
    THINK_TAGS,
    detectModelPolicy,
    buildWorkflowMessages,
    buildCriticMessages,
    parseStructuredResponse,
    buildFacilitatorToolSchema,
  };

  globalThis.InferencePolicy = api;
})();
