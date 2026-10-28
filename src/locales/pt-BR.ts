import { DAILY_PROMPT } from "../prompts.js";
import { MAX_ACTIONS, MAX_COLLAPSED_ACTIONS } from "../action-policy.js";
import type { UsageSummary } from "../types.js";

import type { Copy } from "./en.js";

const base = {
  sync: {
    devicesTitle: "Em outro dispositivo",
    joinSteps: [
      "Entre na mesma conta do Chrome e ative a sincronização do Chrome.",
      "Abra a página de sincronização do Aside e entre com a mesma frase secreta.",
      "Permita o acesso aos serviços de modelos quando solicitado nesse dispositivo.",
    ],
    mergeTitle: "Como as alterações são combinadas",
    mergeRules: [
      {
        title: "Novos itens",
        description: "Itens criados em qualquer dispositivo são mantidos.",
      },
      {
        title: "Edições",
        description: "Vale a última versão salva do mesmo item.",
      },
      {
        title: "Exclusões",
        description: "São sincronizadas; edições antigas não restauram o item.",
      },
      {
        title: "Modelo padrão",
        description:
          "A escolha sincronizada só é usada se este dispositivo não tiver uma.",
      },
    ],
    manageTitle: "Gerenciar sincronização",
    stopHelp:
      "Mantém as configurações locais. Os outros dispositivos continuam sincronizando.",
    clearHelp:
      "Remove a cópia compartilhada e mantém as configurações locais. Os outros dispositivos precisam configurar a sincronização novamente.",
    accessTitle: "Permitir acesso aos serviços de modelos",
    accessHelp:
      "Antes de usar seus modelos, permita que este navegador acesse os serviços abaixo.",
    allowAccess: "Permitir acesso",
    accessReady:
      "Todos os endereços dos serviços de modelos estão autorizados neste navegador.",
    accessDenied:
      "O acesso não foi autorizado. Você pode tentar novamente; suas configurações sincronizadas serão mantidas.",
    joinExisting: "Entrar em uma sincronização existente",
    waitingHelp:
      "As configurações sincronizadas ainda não chegaram. Se a sincronização já estiver ativa em outro dispositivo, use a mesma conta do Chrome, mantenha a sincronização do Chrome ativada e aguarde. Quando as configurações chegarem, você poderá inserir sua frase secreta atual.",
    firstSetup: "Configurar pela primeira vez",
    checkAgain: "Verificar novamente",
    forgotPassphrase: "Esqueceu a frase-senha?",
    resetSync: "Redefinir sincronização",
    resetText:
      "A frase-senha antiga não pode ser recuperada. A redefinição exclui as configurações sincronizadas na nuvem, mas mantém as configurações e chaves de API de cada dispositivo. Configure a sincronização novamente com uma nova frase-senha em um dispositivo que ainda tenha todas as suas configurações. Os outros dispositivos também precisarão da nova frase-senha para retomar a sincronização. Configurações guardadas apenas na nuvem não poderão ser recuperadas.",
    scopeTitle: "Sincronizado",
    localOnlyTitle: "Somente neste dispositivo",
    createHelp:
      "Defina uma nova frase secreta apenas se ainda não tiver ativado a sincronização em nenhum dispositivo. Os outros dispositivos usarão a mesma frase para entrar.",
    joinHelp:
      "Digite a mesma frase-senha definida em outro dispositivo. Use a mesma conta do Chrome com a sincronização ativada.",
    details: "Detalhes e gerenciamento da sincronização",
    scope: [
      "Conexões de modelos e chaves de API",
      "Ações",
      "Configurações das reflexões",
    ],
    localOnly: [
      "Coleção e reflexões geradas",
      "Histórico de solicitações e cache",
      "Idioma, tema e preferências do dispositivo",
    ],
    join: "Participar da sincronização",
    joinTitle: "Combinar configurações?",
    joinText:
      "Combinar as configurações deste dispositivo com as sincronizadas? Algumas poderão ser atualizadas. Conexões e ações exclusivas deste dispositivo serão mantidas. Coleções e preferências pessoais não serão afetadas.",
    title: "Sincronização",
    intro:
      "Sincronize configurações criptografadas entre dispositivos com sua conta do Chrome.",
    requirements:
      "O Chrome transmite as alterações em segundo plano. Se não chegarem, verifique a sincronização do Chrome e a rede.",
    passphrase: "Frase secreta de sincronização",
    confirmPassphrase: "Confirmar frase secreta",
    passphraseHelp:
      "Guarde esta frase-senha: ela não pode ser recuperada. Digite-a novamente após reiniciar o Chrome ou recarregar a extensão.",
    locked:
      "Digite sua frase-senha original para retomar a sincronização. Suas configurações locais continuam disponíveis.",
    ready: "A sincronização está ativada.",
    lastSync: "Última sincronização neste dispositivo",
    create: "Ativar sincronização",
    unlock: "Desbloquear sincronização",
    syncNow: "Sincronizar agora",
    stop: "Parar neste dispositivo",
    clear: "Excluir configurações sincronizadas",
    clearText:
      "Excluir as configurações criptografadas do Chrome Sync e parar a sincronização aqui? As configurações e chaves locais serão mantidas. Outros dispositivos precisarão ser configurados novamente. Se esqueceu a frase, poderá criar uma nova cópia.",
    stopText:
      "Parar a sincronização neste dispositivo? As configurações e chaves locais continuarão disponíveis. A cópia sincronizada e outros dispositivos não serão afetados.",
    done: "Configurações de sincronização atualizadas",
    working: "Processando…",
    errors: {
      passphraseRequired: "Digite sua frase secreta.",
      passphraseShort: "Use pelo menos {min} caracteres.",
      mismatch: "As frases secretas não correspondem.",
      wrongPassphrase:
        "A frase está incorreta ou os dados sincronizados não puderam ser autenticados.",
      locked: "Primeiro desbloqueie a sincronização com sua frase secreta.",
      waiting:
        "O Chrome ainda está recebendo as configurações. Tente novamente em instantes.",
      tooLarge:
        "As configurações excedem o espaço de sincronização disponível. Encurte as instruções ou remova configurações não utilizadas.",
      version:
        "A versão das configurações é diferente. Atualize o Aside nos seus dispositivos.",
      invalidData:
        "As configurações sincronizadas são inválidas e não foram aplicadas.",
      remoteMissing:
        "A cópia sincronizada foi excluída. As configurações locais foram mantidas. Exclua a configuração de sincronização e ative novamente.",
      unavailable:
        "Não foi possível sincronizar. Verifique o Chrome Sync e sua conexão e tente novamente.",
    },
  },
  brand: "Aside",
  about: {
    version: "Versão atual",
    resources: "Projeto e suporte",
    project: "Página do projeto",
    feedback: "Relatar um problema",
    privacy: "Política de privacidade",
    openSource: "Agradecimentos ao código aberto",
    licenseName: "licença MIT",
    licenseIntro:
      "O Aside usa a {license}. Agradecemos a estes projetos de código aberto.",
    darkReader: "Modo escuro de sites",
    marked: "Renderização de Markdown",
    dompurify: "Sanitização de HTML",
  },
  nav: {
    sync: "Sincronização",
    help: "Sobre",
    home: "Coleção",
    actions: "Ações",
    appearance: "Estilo dos resultados",
    connections: "Conexões",
    shortcuts: "Atalhos de teclado",
  },
  shortcuts: {
    intro: "Veja os atalhos atuais e personalize-os como preferir.",
    settings: "Configurar atalhos",
    unset: "Não definido",
    help: (name: string) =>
      `Clique em “Configurar atalhos”, encontre “${name}” no Chrome e edite um atalho pressionando a nova combinação de teclas. Você também pode reatribuir teclas já usadas.`,
    items: {
      "switch-recent-tab": {
        name: "Alternar abas recentes",
        description:
          "Alterne entre as duas últimas abas visualizadas nesta janela.",
      },
      "quick-question": {
        name: "Perguntas rápidas",
        description:
          "Disponível em páginas da web comuns. Usa o texto selecionado ou a página inteira se nada estiver selecionado. Digite uma pergunta para receber a resposta.",
      },
    },
  },
  settings: "Configurações",
  contentGroup: "Conteúdo",
  closeNavigation: "Fechar navegação",

  defaultModel: "Modelo padrão",
  connectionPlaceholders: {
    name: "Meu modelo",
    url: "https://api.example.com/v1",
    model: "model-name",
  },
  libraryTitle: "Ações",
  libraryIntro:
    "Crie instruções reutilizáveis para páginas e textos selecionados.",
  newAction: "Nova ação",
  actionName: "Nome",
  actionPlaceholder: "Por exemplo: Explicar termos técnicos",
  instruction: "Como o conteúdo deve ser processado?",
  additionalInstructions: "Instruções adicionais (opcional)",
  additionalInstructionsPlaceholder:
    "Deixe em branco para usar o comportamento padrão ou adicione requisitos específicos.",
  instructionPlaceholder:
    "Descreva o objetivo, o que deve ser preservado e como o resultado deve ser escrito.",
  actionCount: (n: number) => `${n} itens`,
  quick: "Acesso rápido",
  quickHelp: `Mostrar na barra de seleção. As primeiras ${MAX_COLLAPSED_ACTIONS} ações ativadas aparecem quando a barra está recolhida.`,
  quickToggle: (name: string) => `Adicionar “${name}” ao acesso rápido`,
  moveUp: "Mover para cima",
  moveDown: "Mover para baixo",
  edit: "Editar",
  duplicate: "Duplicar",
  remove: "Excluir",
  custom: "Personalizado",
  mode: "Como processar o conteúdo",
  modes: { paragraph: "Cada parágrafo", whole: "Tudo junto" },
  modeShort: { paragraph: "Por parágrafo", whole: "Combinado" },
  modeHints: {
    paragraph: "Um resultado por parágrafo. Útil para tradução e reescrita.",
    whole: "Um resultado para todo o conteúdo. Útil para resumos e extração.",
  },
  placements: { inline: "Abaixo do original", panel: "Painel flutuante" },
  appearanceTitle: "Estilo dos resultados",
  appearanceIntro:
    "Ajuste as cores e a tipografia dos resultados com uma prévia em tempo real.",
  appearanceSample: {
    category: "NOTAS DE LEITURA / 004",
    original:
      "A useful note does more than repeat a sentence. It connects an idea to a question, an experience, or another idea. Those connections make knowledge easier to recall and use.",
    result:
      "Uma boa anotação faz mais do que repetir uma frase. Ela conecta uma ideia a uma pergunta, uma experiência ou outra ideia. Essas conexões tornam o conhecimento mais fácil de lembrar e aplicar.",
  },
  connectionsTitle: "Conexões de modelos",
  connectionsIntro: "Gerencie as conexões de modelos para processar conteúdo.",
  createTitle: "Nova ação",
  editTitle: "Editar ação",
  editorIntro:
    "Descreva a tarefa, teste com um texto de exemplo e salve a ação.",
  advanced: "Mais configurações",
  model: "Modelo",
  followDefault: (name: string) => `Usar padrão · ${name}`,
  placement: "Exibir resultados da página",
  placementHelp: "O texto selecionado usa um painel flutuante.",
  save: "Salvar",
  cancel: "Cancelar",
  back: "Voltar",
  required: "Preencha os campos obrigatórios.",
  saved: (name: string) => `“${name}” salvo`,
  duplicated: "Duplicado. Você pode editar a nova cópia.",
  discardTitle: "Alterações não salvas",
  discardText: "As alterações atuais serão descartadas.",
  discard: "Descartar alterações",
  keepEditing: "Continuar editando",
  removeTitle: "Excluir esta ação?",
  removeText:
    "Ela também será removida dos menus da página e da barra de seleção de texto.",
  removed: "Ação excluída",
  test: "Teste",
  input: "Entrada",
  testInputPlaceholder: "Digite ou cole seu próprio texto",
  customInput: "Texto personalizado",
  run: "Executar",
  rerun: "Executar novamente",
  running: "Processando…",
  stop: "Parar",
  emptyResult: "O resultado aparecerá aqui",
  output: "Resultado",
  stale: "A entrada ou as instruções mudaram. Execute o teste novamente.",
  inputRequired: "Adicione as instruções e o texto de entrada primeiro.",
  source: "Original",
  copy: "Copiar resultado",
  copied: "Resultado copiado",
  copyFailed:
    "O acesso à área de transferência foi bloqueado. Selecione e copie o texto manualmente.",
  close: "Fechar",
  chooseAction: "Ação",
  start: "Executar ação",
  restore: "Restaurar original",
  noActions: "Crie uma ação primeiro",
  styleTarget: "Local dos resultados",
  styleTargets: {
    page: "Resultados na página",
    selection: "Painel de seleção",
  },
  textColor: "Cor do texto",
  picker: {
    choose: "Escolher uma cor",
    hue: "Matiz",
    saturation: "Saturação",
    brightness: "Brilho",
    hex: "Hex",
    red: "Vermelho",
    green: "Verde",
    blue: "Azul",
    invalidHex: "Insira uma cor hexadecimal de 3 ou 6 dígitos.",
  },
  addColor: "Salvar cor personalizada",
  customColor: (color: string) => `Cor personalizada ${color}`,
  removeColor: (color: string) => `Remover cor ${color}`,
  customTypography: "Personalizar tamanho e espaçamento",
  typographyHint:
    "Por padrão, segue a fonte, o tamanho e o espaçamento originais. Ative para ajustar o tamanho e o espaçamento.",
  fontSize: "Tamanho da fonte",
  lineHeight: "Espaçamento entre linhas",
  tint: "Cor de fundo",
  livePreview: "Prévia em tempo real",
  resetStyle: "Redefinir estilo",
  paletteNames: ["Verde pinho", "Grafite", "Índigo", "Marrom quente"],
  addConnection: "Adicionar conexão de API",
  duplicateConnection: "Duplicar conexão",
  connectionName: "Nome",
  serviceUrl: "URL base",
  modelName: "Nome do modelo",
  apiKey: "Chave de API",
  connectionNote:
    "As chaves ficam neste navegador. O teste usa a URL e a chave de API para buscar a lista de modelos, sem gerar conteúdo.",
  connected: "Configurado",
  default: "Padrão",
  setDefault: "Definir como padrão",
  defaultChanged: "Modelo padrão atualizado",
  testConnection: "Testar conexão",
  testingConnection: "Testando conexão…",
  connectionTested: "Conexão bem-sucedida",
  copiedSuffix: "cópia",
  uiLanguage: "Idioma da interface",
  uiTheme: "Tema da interface",
  systemLanguage: "Idioma do sistema",
  themes: { system: "Tema do sistema", light: "Claro", dark: "Escuro" },
  previous: "Voltar",
  forward: "Avançar",
  unsaved: "Não salvo",
  translation: "Traduzir",
  sourceLanguage: "Idioma de origem",
  targetLanguage: "Idioma de destino",
  outputLanguage: "Idioma de saída",
  outputLength: "Extensão da resposta",
  outputLengths: {
    brief: "Breve",
    balanced: "Equilibrada",
    detailed: "Detalhada",
  },
  outputLengthHint:
    "Cerca de 1–3 frases, um parágrafo ou 2–3 parágrafos; uma orientação, não um limite rígido.",
  followInstructionLanguage: "Seguir o idioma das instruções",
  additionalInstructionsRequired: "Requisitos adicionais (obrigatórios)",
  instructionLanguageHint:
    "Escreva os requisitos adicionais no idioma de saída desejado.",
  followInterfaceLanguage: "Seguir o idioma da interface",
  swapLanguages: "Inverter idiomas",
  translationHint:
    "O idioma de destino pode seguir o idioma da interface ou ser definido separadamente.",
  translationInstructions: "Instruções de tradução",
  languages: {
    auto: "Detectar automaticamente",
    "zh-Hans": "Chinês simplificado",
    "zh-Hant": "Chinês tradicional",
    en: "Inglês",
    ja: "Japonês",
    ko: "Coreano",
    fr: "Francês",
    de: "Alemão",
    es: "Espanhol",
    pt: "Português",
    ar: "Árabe",
    ru: "Russo",
    "pt-BR": "Português (Brasil)",
    id: "Indonésio",
    it: "Italiano",
    tr: "Turco",
    th: "Tailandês",
    vi: "Vietnamita",
  },
  defaultTextColor: "Cor de texto padrão",
  themeColor: "Seguir a cor do tema",
  searchOptions: "Buscar opção",
  noOptions: "Nenhuma opção encontrada",
  connectionList: "Conexões",
  newConnection: "Nova conexão",
  notConnected: "Não conectado",
  connectionSaved: "Conexão salva",
  defaultConnectionHint:
    "Usado por ações que não especificam um modelo próprio.",
  pageMenu: "Alternar página",
  colorPalette: "Paleta de cores",
  colorMode: "Aparência",
  palettes: {
    graphite: "Grafite",
    paper: "Papel",
    ocean: "Oceano",
    dusk: "Crepúsculo",
    forest: "Floresta",
  },
  bookmark: "Salvar na coleção",
  bookmarked: "Na coleção",
  bookmarkAdded: "Salvo na coleção",
  home: {
    setupLink: "Adicione uma conexão de modelo",
    setupHint: "{link} para gerar a reflexão do dia.",
    title: "Coleção",
    intro:
      "Guarde trechos processados para uma leitura mais atenta e tranquila.",
    daily: "Reflexão do dia",
    dailySettings: "Configurar uma reflexão",
    dailyHideTitle: "Ocultar a reflexão do dia?",
    dailyHideText:
      "Sua reflexão e as configurações serão mantidas. Use “Mostrar reflexão do dia” ao lado do título Coleção para exibi-la novamente.",
    dailyHide: "Ocultar",
    dailyRestore: "Mostrar reflexão do dia",
    collectionTitle: "Trechos",
    count: (n: number) => `${n} salvos`,
    search: "Buscar",
    closeSearch: "Recolher busca",
    clearSearch: "Limpar busca",
    matchedCount: (shown: number, total: number) =>
      `${shown} / ${total} salvos`,
    options: "Mais",
    openSource: "Abrir página de origem",
    localSource: "Trecho local",
    empty: "Sua coleção está vazia",
    noMatches: "Nenhum trecho encontrado",
    detail: "Trecho salvo",
    original: "Ver original",
    source: "Origem",
    removeTitle: "Remover este trecho?",
    removeText:
      "Apenas esta cópia salva será removida. O original e a ação continuarão disponíveis.",
    removed: "Trecho removido",
    prompt: "Instruções",
    promptHelp: "Uma breve reflexão sobre leitura e pensamento.",
    promptDefault: DAILY_PROMPT["pt-BR"],
    useCollection: "Usar minha coleção",
    useCollectionHint:
      "Quando ativado, inclui até 5 trechos salvos como referência.",
    preview: "Gerar prévia",
    previewTitle: "Prévia",
    previewEmpty: "Sua reflexão aparecerá aqui.",
    saveSettings: "Salvar configurações",
    savePreview: "Salvar e usar prévia",
    promptRequired: "Descreva o que você quer gerar.",
    settingsSaved: "Configurações do conteúdo diário salvas",
  },
  actionOptions: "Mais",
  presets: {
    translate: {
      name: "Traduzir",
      description:
        "Escolha os idiomas de origem e destino. Preserve a estrutura original.",
    },
    plain: {
      name: "Explicar texto clássico",
      description:
        "Explique textos clássicos de qualquer idioma em linguagem moderna e clara.",
    },
    explain: {
      name: "Explicar o conteúdo",
      description:
        "Explique a ideia principal, os termos e o contexto, com notas de pronúncia para palavras incomuns.",
    },
    summary: {
      name: "Pontos principais",
      description: "Reúna os pontos mais úteis do conteúdo.",
    },
    qa: {
      name: "Perguntas rápidas",
      description:
        "Responda diretamente às perguntas, no idioma e na extensão de sua preferência.",
    },
  },
};

const full = {
  ...base,
  processingNotice: "O conteúdo será enviado ao serviço de modelo selecionado.",
  real: {
    brand: base.brand,
    actionName: base.actionName,
    instruction: base.instruction,
    additionalInstructions: base.additionalInstructions,
    additionalInstructionsPlaceholder: base.additionalInstructionsPlaceholder,
    model: base.model,
    defaultModel: base.defaultModel,
    addAction: base.newAction,
    expandToolbar: "Expandir",
    collapseToolbar: "Recolher",
    save: base.save,
    requiredAction: base.required,
    sourceLanguage: base.sourceLanguage,
    targetLanguage: base.targetLanguage,
    outputLanguage: base.outputLanguage,
    outputLength: base.outputLength,
    outputLengths: base.outputLengths,
    outputLengthHint: base.outputLengthHint,
    followInterfaceLanguage: base.followInterfaceLanguage,
    followInstructionLanguage: base.followInstructionLanguage,
    additionalInstructionsRequired: base.additionalInstructionsRequired,
    instructionLanguageHint: base.instructionLanguageHint,
    languages: base.languages,
    openTools: "Abrir ferramentas do Aside",
    collapseTools: "Recolher ferramentas",
    floatingHint:
      "Aside · Clique para abrir as ferramentas, arraste para mover",
    pageTranslated: "Tradução exibida",
    translationStates: {
      original: "Original",
      processing: "Traduzindo",
      translated: "Traduzido",
    },
    pageColor: "Usar a cor do texto original",
    regenerate: "Gerar novamente",
    regenerateHint: "Ignorar o cache local e solicitar um novo resultado",
    loadModels: "Teste a conexão para carregar os modelos",
    selectModel: "Escolha um modelo",
    noModels: "Conexão bem-sucedida, mas o serviço não retornou modelos.",
    modelListHint:
      "Teste a conexão novamente para atualizar a lista de modelos.",
    advancedSettings: "Configurações avançadas",
    concurrency: "Solicitações simultâneas",
    batchChars: "Caracteres por lote",
    batchCount: "Itens por lote",
    processingHint:
      "As abas compartilham o limite de simultaneidade desta conexão. O conteúdo visível tem prioridade; os resultados em cache aparecem imediatamente.",
    localHits: "Cache local: {hits}/{total} itens",
    sharedItems: "{shared} itens compartilhados",
    cacheWriteFailed: "Falha ao gravar no cache",

    modelPurpose: "Finalidade do modelo",
    purposes: { generation: "Geração", decision: "Decisão" },
    decisionHint:
      "Para decisões como o modo escuro aprimorado, separado da geração de conteúdo.",
    decisionExperimental:
      "As decisões de imagem do TypeSafe são experimentais. O teste apenas lê a lista de modelos.",
    protocol: "Protocolo de API",
    protocols: {
      typesafe: "TypeSafe System One",
      chat: "Compatível com OpenAI · Chat Completions",
      responses: "OpenAI Responses",
      anthropic: "Anthropic Messages",
      gemini: "Gemini Interactions",
    },
    noConnection: "Nenhuma conexão de modelo",
    noSavedKey: "Chave de API; opcional para serviços locais",
    keepKey: "Deixe em branco para manter a chave salva",
    connectionRemoved: "Conexão excluída",
    removeConnection: "Excluir conexão",
    removeConnectionText:
      "As ações que usam esta conexão passarão a usar o padrão compartilhado.",
    reasoningEffort: "Nível de raciocínio",
    reasoningDefault: "Padrão do serviço",
    reasoningLevels: {
      none: "Nenhum",
      minimal: "Mínimo",
      low: "Baixo",
      medium: "Médio",
      high: "Alto",
      xhigh: "Muito alto",
      max: "Máximo",
    },
    reasoningHint:
      "Mostra apenas os níveis compatíveis com este modelo e API. O padrão mantém a configuração do serviço; níveis maiores geralmente consomem mais tempo e tokens.",
    reasoningUnsupported:
      "Não há níveis de raciocínio verificados para este modelo e API. Será usado o padrão do serviço.",
    reasoningInvalid: (level: string) =>
      `${level} · Incompatível; escolha novamente`,
    maxTokens: "Máximo de tokens de saída",
    maxTokensHint: "Usado por Responses, Messages e Interactions.",
    openaiCache: "Cache de prefixo",
    cacheModes: {
      auto: "Cache implícito",
      explicit: "Prefixo de instrução explícito",
    },
    cacheHint:
      "O cache explícito requer GPT-5.6 ou posterior com suporte a pontos de interrupção. Use cache implícito com outros modelos ou proxies. Instruções curtas podem não atingir o limite mínimo de cache do serviço.",
    failed: "Falha no processamento",
    status: "Status",
    idle: "Não iniciado",
    done: "Concluído",
    progress: (n: number, total: number) =>
      `${n} / ${total} trechos processados`,
    currentPage: "Página atual",
    processSelection: "Processar seleção com o Aside",
    unsupportedPage:
      "Esta página não permite extensões. Abra uma página da web comum primeiro.",
    noTarget: "Clique primeiro no ícone da extensão na página desejada.",
    pageTitle: "Título da página",
    sourceUrl: "Página de origem",
    extracted: "Conteúdo extraído",
    inspect: "Inspecionar conteúdo",
    enable: "Ativar nesta página",
    start: "Executar ação",
    stop: "Parar",
    restore: "Restaurar original",
    action: "Ação",
    scope: "Conteúdo",
    body: "Conteúdo principal",
    all: "Página inteira",
    selected: "Texto selecionado",
    selectionHint: "Selecione um texto para processá-lo na barra flutuante.",
    configureModelHint: "Clique aqui para configurar um modelo",
    openHome: "Página inicial da extensão",
    quickQuestion: base.presets.qa.name,
    questionLabel: "Pergunta",
    questionQuote: "Texto citado",
    clearQuestionQuote: "Limpar citação",
    questionPlaceholder: "O que você gostaria de perguntar?",
    answerQuestion: "Responder",
    translatePage: "Traduzir esta página",
    lightsEnabled: "Modo escuro: Ativado",
    lightsDisabled: "Modo escuro: Desativado",
    lightsSystem: "Modo escuro: Sistema",
    lightsPermissionNeeded:
      "Permita o acesso ao site para que o modo escuro possa ler os estilos da página.",
    resizePanel: "Redimensionar painel",
    processing: "Processando…",
    chooseAction: "Escolha uma ação",
    close: "Fechar",
    copy: "Copiar",
    copied: "Copiado",
    bookmark: "Salvar",
    saved: "Salvo",
    pin: "Fixar",
    unpin: "Desafixar",
    cancel: "Cancelar",
    retry: "Tentar novamente",
    settings: "Configurações",
    source: "Original",
    output: "Resultado",
    sourceMissing: "O conteúdo de origem mudou. Execute a ação novamente.",
    noContent: "Nenhum texto processável encontrado.",
    updated: "Configurações atualizadas",
    dailyReadyHint:
      "Comece sua leitura com uma reflexão. Use o botão de atualização à direita para gerar uma.",
    dailyConnectionHint:
      "Adicione um modelo em Conexões de modelos e escolha-o nas configurações da reflexão.",
    dailyRefresh: "Atualizar",
    dailyWorking: "Gerando…",
    resultStyles: "Usa os estilos de resultado configurados",
    remove: "Excluir",
    frameLimit:
      "PDFs, páginas incorporadas de outras origens e textos em imagens não são processados.",
    errors: {
      noDecisionConnection: "Configure primeiro um modelo de decisão padrão.",
      invalidDecision: "O serviço de decisão retornou um resultado inválido.",
      actionLimit: `Você pode salvar até ${MAX_ACTIONS} ações. Remova primeiro uma ação personalizada que não usa.`,
      recordDeleted:
        "Este item foi excluído. Crie um novo para salvar estas alterações.",
      invalidAction: "Insira configurações de ação válidas.",
      presetActionProtected: "As ações predefinidas não podem ser excluídas.",
      sameLanguages:
        "Os idiomas de origem e destino são iguais. Escolha outro idioma antes de traduzir.",
      invalidProcessing:
        "Use 1–8 solicitações simultâneas, 4000–32000 caracteres e 1–32 itens por lote.",
      cacheError:
        "Não foi possível ler o cache local. Verifique ou limpe-o em Uso e tente novamente.",
      sourceChanged: "O conteúdo de origem mudou. Execute a ação novamente.",
      invalidUrl:
        "Use uma URL de serviço HTTPS. Serviços locais podem usar localhost ou 127.0.0.1.",
      invalidProtocol: "Escolha um protocolo de API válido.",
      credentialsUnavailable:
        "O armazenamento local de chaves de API está indisponível. Recarregue a extensão e tente novamente.",
      invalidConnection:
        "Insira um nome para a conexão e verifique as configurações.",
      modelRequired: "Teste a conexão e escolha um modelo na lista retornada.",
      invalidReasoning:
        "Este nível de raciocínio não é compatível. Escolha um nível compatível ou Padrão do serviço na conexão do modelo e salve.",
      invalidModelList:
        "O serviço retornou uma lista de modelos inválida. Verifique a URL e o protocolo de API.",
      invalidInput: "Nenhum conteúdo de entrada válido.",
      noConnection:
        "Adicione uma conexão de modelo e defina-a como padrão primeiro.",
      permissionRequired:
        "Autorize o acesso ao serviço nas configurações da conexão.",
      notAllowed: "Esta operação não foi autorizada.",
      authError:
        "Falha na autenticação. Verifique a chave e o acesso ao modelo.",
      rateLimited:
        "Limite de solicitações ou cota atingido. Tente novamente mais tarde.",
      serviceError: "O serviço de modelo retornou um erro.",
      extensionDisconnected:
        "A conexão com a extensão foi interrompida. Atualize a página e tente novamente.",
      emptyOutput: "O modelo não retornou texto.",
      invalidOutput:
        "A estrutura dos trechos retornados é inválida. Tente novamente ou ajuste as instruções.",
      outputLimit:
        "A saída atingiu um limite do modelo. Reduza a entrada ou aumente o limite de saída.",
      inputLimit:
        "O conteúdo é longo demais. Selecione menos texto ou processe por parágrafo.",
      interrupted: "O processamento foi interrompido. Tente novamente.",
      cancelled: "Interrompido",
      timeout: "O modelo excedeu o tempo limite. Tente novamente.",
      networkError:
        "Não foi possível acessar o modelo. Verifique a URL do serviço, a rede e as permissões.",
    },
  },
};

const usage = {
  details: "Detalhes",
  detailTitle: "Detalhes da solicitação",
  instructions: "Instruções",
  content: "Conteúdo",
  noOutput: "Nenhuma saída recebida.",
  detailsUnavailable: "Os detalhes desta solicitação não foram registrados.",
  localCache: "Cache local de resultados",
  cacheInfo: (n: number, mb: string, limit: number) =>
    `${n} itens · ${mb} / ${limit} MB`,
  cacheNote:
    "Textos e configurações iguais reutilizam resultados entre páginas sem chamar o modelo. O cache de 50 MB remove os resultados menos usados recentemente. Gerar novamente solicita uma nova saída. O cache contém textos processados, nunca chaves.",
  cacheClear: "Limpar cache",
  cacheClearTitle: "Limpar o cache local de resultados?",
  cacheClearText:
    "Os próximos processamentos solicitarão novos resultados. Trechos salvos, conexões e registros de uso serão mantidos.",
  cacheCleared: "Cache local limpo",
  cacheReload: "Atualizar tamanho",

  dailyUsage: "Uso diário",
  chartValue: (value: string) => `${value} tokens`,
  chartEmpty: "O uso diário aparecerá aqui quando houver chamadas registradas.",
  chartMissing: "Total não informado",
  chartPartial: "Parcialmente informado",
  chartDay: (date: string, total: string, calls: string) =>
    `${date} · ${total} · ${calls} ${calls === "1" ? "chamada" : "chamadas"}`,
  title: "Uso",
  intro:
    "Confira as chamadas aos modelos e o uso de tokens informado por cada serviço.",
  period: "Período",
  periods: {
    all: "Todo o período",
    today: "Hoje",
    "7": "Últimos 7 dias",
    "30": "Últimos 30 dias",
  },
  model: "Modelo / conexão",
  allModels: "Todos os modelos",
  inputTokens: "Entrada",
  outputTokens: "Saída",
  cachedTokens: "Em cache",
  cacheWriteTokens: "Gravações no cache",
  reasoningTokens: "Raciocínio",
  totalTokens: "Total",
  tokens: "Tokens informados",
  withinInput: "Incluído na entrada",
  records: "Histórico de chamadas",
  time: "Horário",
  source: "Finalidade",
  status: "Status da chamada",
  coverage: (s: UsageSummary) =>
    `${s.calls} chamadas · ${s.reported} informadas · ${s.partial} parciais · ${s.missing} não informadas`,
  note: "Cada linha é uma solicitação ao modelo; lotes geram registros separados. Os totais incluem apenas o uso recebido. Leituras e gravações de cache fazem parte da entrada e não são somadas duas vezes. A OpenAI inclui o raciocínio na saída; o Gemini o informa separadamente. Os totais priorizam valores do serviço. — indica que o serviço não informou um valor.",
  unreported: "Não informado pelo serviço",
  sources: {
    connectionTest: "Teste de conexão",
    trial: "Teste",
    preview: "Prévia da web",
    page: "Processamento da página",
    selection: "Texto selecionado",
    daily: "Conteúdo diário",
    processing: "Processamento de conteúdo",
    lightsEnhance: "Modo escuro aprimorado",
  },
  statuses: {
    success: "Concluído",
    cancelled: "Interrompido",
    error: "Falhou",
  },
  reporting: {
    reported: "Uso informado",
    partial: "Uso parcial",
    missing: "Uso indisponível",
  },
  empty: "Nenhuma chamada registrada",
  more: "Mostrar mais",
  clear: "Limpar histórico",
  clearTitle: "Limpar todos os registros de uso?",
  clearText:
    "Isso exclui todos os registros locais de chamadas. Conexões, ações e conteúdo salvo serão mantidos. Esta operação não pode ser desfeita.",
  cleared: "Histórico de uso limpo",
};

const popup = {
  currentPage: "Página atual",
  process: "Processar conteúdo",
  features: "Ferramentas rápidas",
  siteOnly: "Somente este site",
  toolbar: "Barra de seleção",
  floating: "Botão flutuante",
};

const copy: Copy = {
  ...full,
  nav: { ...full.nav, usage: usage.title },
  usage,
  popup,
};
export default copy;
