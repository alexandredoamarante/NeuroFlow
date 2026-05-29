# neuroaark

Uma ferramenta centralizada de organização e foco que une anotações hierárquicas, gestão de tempo e acompanhamento de tarefas. O **neuroaark** foi projetado para ser seu "segundo cérebro" local, priorizando a estabilidade, privacidade e velocidade.

## Link de Acesso
**[Acesse o neuroaark aqui](https://neuroaark.pages.dev/)**

---

## 🛡️ Arquitetura Offline-First e Privacidade

O **neuroaark** opera sob uma filosofia de **Privacidade Total**. Todos os seus dados — tarefas, notas, destaques e imagens — são salvos exclusivamente no seu navegador (LocalStorage).

*   **Sem Nuvem Instável:** Removemos sistemas de sincronização complexos que causavam perda de dados.
*   **Totalmente Local:** Seus dados nunca saem do seu dispositivo sem o seu consentimento.
*   **Acesso Instantâneo:** Sem login, sem conta, sem espera. Comece a organizar agora.

---

## 🚀 Portabilidade: Como mover seus dados?

Como os dados ficam apenas no seu navegador, adicionamos um sistema seguro de **Workspace** para que você possa levar suas notas para onde quiser:

1.  **Exportar Workspace:** Clique no botão **Workspace** no cabeçalho e selecione **Export Workspace**. Isso gerará um arquivo `workspace.json` com tudo o que você criou.
2.  **Transferir:** Envie esse arquivo para seu e-mail, pen-drive ou outro dispositivo.
3.  **Importar Workspace:** No novo dispositivo ou navegador, clique em **Workspace**, selecione **Import Workspace** e escolha o arquivo.
    *   *Dica de Segurança:* O sistema cria automaticamente um backup do seu estado atual (`workspace-backup-before-import.json`) antes de realizar qualquer importação.

---

## Funcionalidades

### 1. Notas Hierárquicas (Árvore de Notas)
*   **Organização Multinível:** Crie notas e sub-notas de forma infinita para organizar pensamentos complexos ou projetos.
*   **Anexos de Mídia:** Suporte para imagens (via Upload ou URL). Imagens enviadas por upload são convertidas em texto (base64) e salvas junto com suas notas.
*   **Conexões [[Wikilinks]]:** Crie links entre notas usando o formato `[[Título da Nota]]`. O sistema expande a árvore automaticamente e rola até a nota alvo com um efeito de brilho.
*   **Estilização Especial:**
    *   `> Greentext`: Linhas que começam com `>` ficam verdes e monoespaçadas.
    *   `< Redtext`: Linhas que começam com `<` ficam vermelhas e monoespaçadas.

### 2. Sistema de Destaques (Marcar Texto)
*   **Estudo Ativo:** Selecione qualquer trecho de uma nota salva para criar um destaque (highlight).
*   **Anotações de Margem:** Cada destaque tem seu próprio campo de comentários, permitindo "dialogar" com seus textos sem poluir a nota principal.
*   **Cores e Links:** Escolha entre 5 cores de marcação. Links em comentários são detectados automaticamente.

### 3. Gestão de Foco e Checklist
*   **Timer Pomodoro:** Cronômetro integrado para sessões de trabalho focado com ciclos personalizáveis.
*   **Checklist de Execução:** Sistema de tarefas simples com barra de progresso visual para acompanhar sua produtividade.

---

## Para o que usar o neuroaark?
*   **Mapeamento Mental:** Estruturação de ideias e brainstorming.
*   **Estudos Acadêmicos:** Organização de matérias e cronogramas de revisão.
*   **Gestão de Projetos Pessoais:** Divisão de grandes objetivos em pequenas tarefas acionáveis.
*   **Zettelkasten:** Criação de um sistema de conhecimento interconectado.

---

## Uso Técnico (Opcional)
Se você for um desenvolvedor e quiser rodar localmente:
1. Clone o repositório.
2. Rode um servidor estático (ex: `python3 -m http.server 8080`).
3. Acesse `localhost:8080`.
