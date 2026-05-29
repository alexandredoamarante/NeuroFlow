# neuroaark

O **neuroaark** é uma ferramenta centralizada de organização e foco que combina anotações hierárquicas, gestão de tarefas e controle de tempo em um único ambiente. Ele funciona como um “segundo cérebro” local, priorizando desempenho, privacidade e simplicidade de uso.

---

## Acesso ao sistema

A aplicação pode ser acessada diretamente pelo navegador:

https://neuroaark.pages.dev/

Não é necessário criar conta, fazer login ou sincronizar dados com servidores externos.

---

## Arquitetura e privacidade

O neuroaark segue um modelo **offline-first**.

Todos os dados (notas, tarefas, destaques e imagens) são armazenados exclusivamente no navegador do usuário por meio de **LocalStorage**.

Isso significa:

- Não existe envio de dados para nuvem  
- Não há autenticação ou contas de usuário  
- Os dados permanecem no dispositivo onde foram criados  
- O acesso é imediato, sem dependências externas  

Essa abordagem reduz pontos de falha e garante controle total do usuário sobre suas informações.

---

## Portabilidade de dados (Workspace)

Como os dados são locais, o sistema oferece um mecanismo de exportação e importação chamado **Workspace**.

O usuário pode exportar todo o ambiente em um arquivo `workspace.json`, contendo todas as informações salvas.

Para isso:

- Acesse o botão **Workspace** no cabeçalho  
- Selecione **Export Workspace**  
- O arquivo será gerado automaticamente  

O arquivo pode ser transferido livremente entre dispositivos (e-mail, pendrive ou armazenamento local).

Para importar dados:

- Abra **Workspace**  
- Selecione **Import Workspace**  
- Escolha o arquivo `workspace.json`  

Antes da importação, o sistema cria automaticamente um backup do estado atual chamado `workspace-backup-before-import.json`, permitindo restauração em caso de erro.

---

## Funcionalidades principais

### Sistema de notas hierárquicas

O neuroaark utiliza uma estrutura em árvore para organização de notas.

- Criação de notas e subnotas em múltiplos níveis  
- Estrutura infinita para organização de ideias complexas  
- Expansão dinâmica da árvore conforme o conteúdo cresce  

### Anexos de mídia

- Imagens podem ser adicionadas por upload ou URL  
- Arquivos enviados são convertidos para **base64** e armazenados junto à nota  

### Conexões entre notas (Wikilinks)

O sistema suporta links internos no formato `[[Nome da Nota]]`.

Quando utilizados:

- A nota alvo é localizada automaticamente  
- A interface expande a árvore necessária  
- A navegação é feita automaticamente até o destino  
- Um efeito visual destaca a transição  

---

### Formatação especial de texto

- Linhas iniciadas com `>` são renderizadas como **greentext** (verde, monoespaçado)  
- Linhas iniciadas com `<` são renderizadas como **redtext** (vermelho, monoespaçado)  

---

### Sistema de destaques (highlighting)

O usuário pode selecionar qualquer trecho de uma nota para criar um destaque independente.

- Cada destaque pode receber comentários próprios  
- Comentários funcionam como anotações laterais sem alterar o texto original  
- Suporte a múltiplos destaques por nota  
- Até 5 cores para categorização visual  
- Links em comentários são detectados automaticamente  

Esse sistema é voltado para leitura ativa, estudo e análise de conteúdo.

---

### Gestão de foco e produtividade

#### Timer Pomodoro

- Cronômetro para sessões de trabalho focado  
- Ciclos configuráveis para organização de produtividade  

#### Checklist de tarefas

- Lista simples de execução de tarefas  
- Acompanhamento visual de progresso  
- Indicador de conclusão de tarefas  

---
