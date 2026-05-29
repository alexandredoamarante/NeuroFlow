# neuroaark

> Um segundo cérebro local. Sem contas. Sem nuvem. Sem distrações.

**neuroaark** é uma ferramenta de organização e foco que unifica notas hierárquicas, gestão de tarefas e controle de tempo em um único ambiente — projetado para funcionar inteiramente no seu navegador, sem depender de servidores externos.

**Acesso:** (https://neuroaark.pages.dev)

---

## Filosofia

A maioria das ferramentas de produtividade exige que você confie seus dados a servidores de terceiros, crie contas e aceite que suas informações transitam por infraestruturas que você não controla.

O neuroaark inverte essa lógica.

Tudo é armazenado no seu próprio navegador, via **LocalStorage**. Não há login. Não há sincronização automática. Não há pontos de falha externos. O que você escreve pertence apenas ao seu dispositivo.

---

## Funcionalidades

### Notas em Árvore Hierárquica
Organize ideias em estruturas de subnota com profundidade infinita. A árvore se expande conforme o conteúdo cresce, sem limites artificiais de hierarquia.

### Wikilinks (`[[Título da Nota]]`)
Conecte notas entre si com links internos no estilo `[[Nome]]`. Ao clicar, o sistema localiza a nota automaticamente, expande a árvore até ela e aplica um efeito visual de destaque.

### Sistema de Destaques com Comentários
Selecione qualquer trecho de texto de uma nota para criar um destaque independente. Cada destaque suporta:
- Comentários laterais sem alterar o texto original
- 5 cores para categorização visual
- Detecção automática de URLs nos comentários
- Persistência exata da posição do trecho

### Formatação Especial de Texto
- Linhas iniciadas com `>` → renderizadas como **greentext** (verde monoespaçado)
- Linhas iniciadas com `<` → renderizadas como **redtext** (vermelho monoespaçado)

### Anexos de Mídia
Adicione imagens a qualquer nota via upload ou URL. Arquivos enviados são convertidos para base64 e armazenados junto à nota, sem dependências externas.

### Checklist de Tarefas
Gerencie listas de tarefas com acompanhamento visual de progresso e indicador de conclusão.

### Timer Pomodoro
Sessões de trabalho focado com ciclos configuráveis para organização de produtividade.


---


## Portabilidade de Dados (Workspace)

Como os dados são locais, o neuroaark oferece um sistema de exportação/importação para mover seu ambiente entre dispositivos.

**Exportar:**
1. Clique em **Workspace** no cabeçalho
2. Selecione **Export Workspace**
3. O arquivo `workspace.json` será gerado automaticamente

**Importar:**
1. Abra **Workspace**
2. Selecione **Import Workspace**
3. Escolha o arquivo `workspace.json`

> Antes de qualquer importação, o sistema cria automaticamente um backup do estado atual como `workspace-backup-before-import.json`.


---


## Dicas de Uso

**Zettelkasten com Wikilinks:** Crie notas interconectadas usando `[[Nome da Nota]]` para construir uma rede de conhecimento navegável.

**Leitura Ativa com Destaques:** Use o sistema de highlights para "dialogar" com seus próprios textos — marque trechos e adicione camadas de análise sem alterar o conteúdo original.

**Greentext para Conclusões:** Use `> ` no início de linhas para destacar insights, citações ou conclusões positivas de forma visual.

**Redtext para Alertas:** Use `< ` para marcar pontos de atenção, erros ou itens que precisam de revisão.


---

