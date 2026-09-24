#!/usr/bin/env python3
"""Translate Angular's generated JSON catalog with an installed Argos model.

Angular placeholders are translated segment-by-segment so their spelling and
ordering remain valid for the compile-time localizer. Product names and URLs
are deliberately preserved.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

from argostranslate import translate
from argostranslate import sbd


# Argos models bundle their Stanza tokenizer data. Keep catalog generation
# reproducible without Stanza checking GitHub for a newer resources manifest.
_stanza_pipeline = sbd.stanza.Pipeline


def _offline_stanza_pipeline(*args, **kwargs):
    kwargs.setdefault("download_method", None)
    return _stanza_pipeline(*args, **kwargs)


sbd.stanza.Pipeline = _offline_stanza_pipeline


WORKSPACE = Path(__file__).resolve().parent.parent
SOURCE_PATH = WORKSPACE / "src/locale/messages.json"
PLACEHOLDER = re.compile(r"(\{\$[^}]+\}|\{[A-Za-z][A-Za-z0-9_]*\})")
PROTECTED = re.compile(r"(\s[|·]\s|LivingWiki|Living Wiki|Mind Palace|Stack Studio|\bStack\b|Philly|https?://\S+|\b[a-z]+(?:_[a-z]+)+\b)", re.IGNORECASE)
LETTER = re.compile(r"[A-Za-z]")
MATERIAL_ICON = re.compile(
    r'<[^>]+class="[^"]*material-symbols[^"]*"[^>]*>\s*([a-z][a-z0-9_]*)\s*</'
)
ICON_NAMES = {
    match.group(1)
    for template in (WORKSPACE / "src/app").rglob("*.html")
    for match in MATERIAL_ICON.finditer(template.read_text())
}

TARGETS = {
    "fr": ("fr", WORKSPACE / "src/locale/messages.fr.json"),
    "ja": ("ja", WORKSPACE / "src/locale/messages.ja.json"),
    "pt-BR": ("pb", WORKSPACE / "src/locale/messages.pt-BR.json"),
}
MANUAL_OVERRIDES = {
    "fr": {
        "Public LivingWiki Pages": "Pages LivingWiki publiques",
        "Public LivingWiki pages": "Pages LivingWiki publiques",
        "City LivingWiki pages": "Pages LivingWiki des villes",
        "Find what lights you up.": "Trouvez ce qui vous passionne.",
        "LivingWiki.com is like having a friend who knows everything about your city.": "LivingWiki.com, c’est comme avoir un ami qui sait tout sur votre ville.",
        "What is the LivingWiki platform?": "Qu’est-ce que la plateforme LivingWiki ?",
        "Watch the 60-second intro": "Regardez la présentation de 60 secondes",
        "Search cities, neighborhoods, topics, and upcoming LivingWiki pages...": "Recherchez des villes, des quartiers, des sujets et les prochaines pages LivingWiki…",
        "Sign In": "Se connecter",
        "Cities": "Villes",
        "Others": "Autres",
        "Upgrade": "Mettre à niveau",
        "Light mode": "Mode clair",
        "Dark mode": "Mode sombre",
        "Change language": "Changer de langue",
        "Languages": "Langues",
        "Português (Brasil)": "Português (Brasil)",
        "Create a LivingWiki": "Créer un LivingWiki",
        "Public knowledge, made living": "Le savoir public prend vie",
        "Find what{$LINE_BREAK}lights you up.": "Trouvez ce qui{$LINE_BREAK}vous passionne.",
        "Ask a city. Explore a campus. Discover the boards people make about the places and ideas they know.": "Interrogez une ville. Explorez un campus. Découvrez les tableaux que les gens créent sur les lieux et les idées qu’ils connaissent.",
        "Explore LivingWiki": "Explorer LivingWiki",
        "See how it works": "Voir comment ça marche",
        "Featured LivingWiki pages": "Pages LivingWiki à la une",
        "{$START_TAG_CODE}[City]{$CLOSE_TAG_CODE} and {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE} both work. Some approved global titles intentionally omit the city.": "{$START_TAG_CODE}[City]{$CLOSE_TAG_CODE} et {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE} fonctionnent tous les deux. Certains titres mondiaux approuvés omettent volontairement la ville.",
        "Access your LivingWiki": "Accédez à votre LivingWiki",
        "Continue with Google": "Continuer avec Google",
        "Working...": "Traitement…",
        "Signing In...": "Connexion…",
        "Create Account": "Créer un compte",
        "Creating Account...": "Création du compte…",
        "Public Wikis | LivingWiki": "Wikis publics | LivingWiki",
        "For Business | LivingWiki": "Pour les entreprises | LivingWiki",
        " Be found where your{$LINE_BREAK} city is {$START_TAG_SPAN}already looking.{$CLOSE_TAG_SPAN}": " Soyez visible là où votre{$LINE_BREAK} ville est {$START_TAG_SPAN}déjà en train de chercher.{$CLOSE_TAG_SPAN}",
        "{$START_TAG_SPAN}add_circle{$CLOSE_TAG_SPAN} Build One ": "{$START_TAG_SPAN}add_circle{$CLOSE_TAG_SPAN} Créez le vôtre ",
        "© 2026 Mind Palace Inc. LivingWiki™. All rights reserved.": "© 2026 Mind Palace Inc. LivingWiki™. Tous droits réservés.",
    },
    "ja": {
        "Public LivingWiki Pages": "公開 LivingWiki ページ",
        "Public LivingWiki pages": "公開 LivingWiki ページ",
        "City LivingWiki pages": "都市の LivingWiki ページ",
        "Find what lights you up.": "あなたの心が動くものを見つけよう。",
        "LivingWiki.com is like having a friend who knows everything about your city.": "LivingWiki.com は、あなたの街を何でも知っている友人のような存在です。",
        "What is the LivingWiki platform?": "LivingWiki プラットフォームとは？",
        "Watch the 60-second intro": "60秒の紹介を見る",
        "Search cities, neighborhoods, topics, and upcoming LivingWiki pages...": "都市、地域、トピック、公開予定の LivingWiki ページを検索…",
        "Sign In": "ログイン",
        "Cities": "都市",
        "Others": "その他",
        "Upgrade": "アップグレード",
        "Light mode": "ライトモード",
        "Dark mode": "ダークモード",
        "Change language": "言語を変更",
        "Languages": "言語",
        "Português (Brasil)": "Português (Brasil)",
        "Create a LivingWiki": "LivingWiki を作成",
        "Public knowledge, made living": "公開知識に命を吹き込む",
        "Find what{$LINE_BREAK}lights you up.": "心が動くものを{$LINE_BREAK}見つけよう。",
        "Ask a city. Explore a campus. Discover the boards people make about the places and ideas they know.": "街に尋ね、キャンパスを探検し、人々が知る場所やアイデアについて作ったボードを見つけましょう。",
        "Explore LivingWiki": "LivingWiki を探す",
        "See how it works": "仕組みを見る",
        "Featured LivingWiki pages": "注目の LivingWiki ページ",
        "{$START_TAG_CODE}[City]{$CLOSE_TAG_CODE} and {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE} both work. Some approved global titles intentionally omit the city.": "{$START_TAG_CODE}[City]{$CLOSE_TAG_CODE} と {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE} はどちらも使えます。承認済みのグローバルタイトルには、都市名を含まないものもあります。",
        "Access your LivingWiki": "LivingWiki にアクセス",
        "Continue with Google": "Google で続行",
        "Working...": "処理中…",
        "Signing In...": "ログイン中…",
        "Create Account": "アカウントを作成",
        "Creating Account...": "アカウントを作成中…",
        "Public Wikis | LivingWiki": "公開 Wiki | LivingWiki",
        "For Business | LivingWiki": "ビジネス向け | LivingWiki",
        " Be found where your{$LINE_BREAK} city is {$START_TAG_SPAN}already looking.{$CLOSE_TAG_SPAN}": " あなたの街が{$LINE_BREAK} すでに探している場所で{$START_TAG_SPAN}見つけてもらおう。{$CLOSE_TAG_SPAN}",
        "{$START_TAG_SPAN}add_circle{$CLOSE_TAG_SPAN} Build One ": "{$START_TAG_SPAN}add_circle{$CLOSE_TAG_SPAN} 自分のページを作る ",
        "© 2026 Mind Palace Inc. LivingWiki™. All rights reserved.": "© 2026 Mind Palace Inc. LivingWiki™. 無断転載を禁じます。",
    },
    "pt-BR": {
        "Public LivingWiki Pages": "Páginas públicas do LivingWiki",
        "Public LivingWiki pages": "Páginas públicas do LivingWiki",
        "City LivingWiki pages": "Páginas das cidades no LivingWiki",
        "Find what lights you up.": "Encontre o que inspira você.",
        "LivingWiki.com is like having a friend who knows everything about your city.": "LivingWiki.com é como ter um amigo que sabe tudo sobre a sua cidade.",
        "What is the LivingWiki platform?": "O que é a plataforma LivingWiki?",
        "Watch the 60-second intro": "Assista à apresentação de 60 segundos",
        "Search cities, neighborhoods, topics, and upcoming LivingWiki pages...": "Pesquise cidades, bairros, assuntos e próximas páginas do LivingWiki...",
        "Sign In": "Entrar",
        "Cities": "Cidades",
        "Others": "Outros",
        "Upgrade": "Mudar de plano",
        "Light mode": "Modo claro",
        "Dark mode": "Modo escuro",
        "Change language": "Alterar idioma",
        "Languages": "Idiomas",
        "Português (Brasil)": "Português (Brasil)",
        "Access your LivingWiki": "Acesse seu LivingWiki",
        "Continue with Google": "Continuar com o Google",
        "Working...": "Processando...",
        "Signing In...": "Entrando...",
        "Create Account": "Criar conta",
        "Creating Account...": "Criando conta...",
        "Public Wikis | LivingWiki": "Wikis públicos | LivingWiki",
        "For Business | LivingWiki": "Para empresas | LivingWiki",
        " Be found where your{$LINE_BREAK} city is {$START_TAG_SPAN}already looking.{$CLOSE_TAG_SPAN}": " Seja encontrado onde sua{$LINE_BREAK} cidade {$START_TAG_SPAN}já está procurando.{$CLOSE_TAG_SPAN}",
        "{$START_TAG_SPAN}groups{$CLOSE_TAG_SPAN}{$START_TAG_STRONG}{$INTERPOLATION}{$CLOSE_TAG_STRONG} public LivingWiki pages ": "{$START_TAG_SPAN}groups{$CLOSE_TAG_SPAN}{$START_TAG_STRONG}{$INTERPOLATION}{$CLOSE_TAG_STRONG} páginas públicas do LivingWiki ",
        "{$START_TAG_STRONG}{$INTERPOLATION}{$CLOSE_TAG_STRONG} live": "{$START_TAG_STRONG}{$INTERPOLATION}{$CLOSE_TAG_STRONG} páginas no ar",
        "LivingWiki live": "LivingWiki no ar",
        "City-first": "Cidades em primeiro lugar",
        "Source-aware": "Com fontes verificáveis",
        "Always expanding": "Sempre em expansão",
        "Each LivingWiki is designed to organize public information into something browsable and conversational.": "Cada LivingWiki organiza informações públicas para facilitar a navegação e a conversa.",
        "Start with practical local knowledge, then branch into culture, jobs, climate, food, transit, and civic life.": "Comece com informações locais úteis e explore cultura, empregos, clima, comida, transporte e vida na cidade.",
        "More cities and public topics are queued as the directory grows.": "Novas cidades e temas públicos serão adicionados conforme o diretório crescer.",
        "LivingWiki™ is a product of {$START_TAG_SPAN}Mind Palace Inc.{$CLOSE_TAG_SPAN}": "LivingWiki™ é um produto da {$START_TAG_SPAN}Mind Palace Inc.{$CLOSE_TAG_SPAN}",
        "U.S. college & university LivingWiki pages": "Páginas de faculdades e universidades dos EUA no LivingWiki",
        "Choose a university": "Escolha uma universidade",
        "Choose a city": "Escolha uma cidade",
        "Home": "Início",
        "Claim your business": "Reivindique sua empresa",
        " Claim your business {$START_TAG_SPAN}arrow_forward{$CLOSE_TAG_SPAN}": " Reivindique sua empresa {$START_TAG_SPAN}arrow_forward{$CLOSE_TAG_SPAN}",
        "{$START_TAG_SPAN}play_circle{$CLOSE_TAG_SPAN} Watch · 60 sec ": "{$START_TAG_SPAN}play_circle{$CLOSE_TAG_SPAN} Assista · 60 s ",
        " LivingWiki gives local businesses a place inside the living map of a city: a profile, a pin, guide placement, and signals that help people find the real local places search engines flatten. ": " O LivingWiki dá às empresas locais um lugar no mapa vivo da cidade: um perfil, um ponto no mapa, destaque nos guias e informações que ajudam as pessoas a encontrar estabelecimentos locais. ",
        " Your Local Insider {$START_TAG_SPAN}Any City. Any Language.{$CLOSE_TAG_SPAN}": " Seu guia local {$START_TAG_SPAN}Em qualquer cidade. Em qualquer idioma.{$CLOSE_TAG_SPAN}",
        " Your Local Insider. Any City. Any Language. ": " Seu guia local. Em qualquer cidade. Em qualquer idioma. ",
        " The customer-facing product is a clean multilingual QR badge tied to one real business page. Claim flow happens on the next page; this page shows the finished signal. ": " O produto para clientes é um código QR multilíngue ligado à página da empresa. Você pode reivindicar a página na próxima etapa; aqui mostramos o resultado. ",
        "Walking tours are currently created in personal boards. Team workspaces can create property listings here.": "Passeios a pé são criados em quadros pessoais no momento. Neste espaço de equipe, você pode criar anúncios imobiliários.",
        "{$year} estimate": "{$year} (estimativa)",
        "{$loadedCount}/{$totalCount} temps loaded": "{$loadedCount}/{$totalCount} temperaturas carregadas",
        "{$START_TAG_SPAN}add_circle{$CLOSE_TAG_SPAN} Build One ": "{$START_TAG_SPAN}add_circle{$CLOSE_TAG_SPAN} Crie o seu ",
        "© 2026 Mind Palace Inc. LivingWiki™. All rights reserved.": "© 2026 Mind Palace Inc. LivingWiki™. Todos os direitos reservados.",
        "Meet Kiwi": "Conheça o Kiwi",
        "Ask ": "Pergunte ao ",
        "Open ": "Abrir ",
        "Assistant ": "Assistente ",
        "Edit name and voice of ": "Editar nome e voz de ",
        "Here to talk and help": "Aqui para conversar e ajudar",
        "Your LivingWiki assistant": "Seu assistente do LivingWiki",
        "Voice: ": "Voz: ",
        "End voice conversation": "Encerrar conversa por voz",
        "Start talking with Kiwi": "Começar a conversar com o Kiwi",
        "Speak naturally. Kiwi will answer out loud.": "Fale naturalmente. O Kiwi responderá em voz alta.",
        "Have a conversation with your LivingWiki assistant.": "Converse com seu assistente do LivingWiki.",
        "End conversation": "Encerrar conversa",
        "Start talking": "Começar a conversar",
        "Team draft": "Rascunho da equipe",
        "Sending…": "Enviando…",
        "Saving…": "Salvando…",
        "Send email": "Enviar e-mail",
        "Apply change": "Aplicar alteração",
        "Stop ": "Parar ",
        "Listen to ": "Ouvir ",
        "Save changes": "Salvar alterações",
        "READY TO REVIEW": "PRONTO PARA REVISÃO",
        "TAKING SHAPE": "GANHANDO FORMA",
        "Review and edit anything before you create it.": "Revise e edite tudo antes de criar.",
        "Watch Kiwi fill this board in. You can edit it while it works.": "Acompanhe o Kiwi preencher este quadro. Você pode editá-lo enquanto ele trabalha.",
        "Kiwi needs more detail to finish this draft. Tell it what to add in the box below.": "O Kiwi precisa de mais detalhes para concluir este rascunho. Diga o que adicionar no campo abaixo.",
        "Untitled card": "Cartão sem título",
        "Remove card ": "Remover cartão ",
        "Photo for ": "Foto de ",
        "Finding a photo…": "Procurando uma foto…",
        "No photo yet": "Ainda sem foto",
        "Searching…": "Pesquisando…",
        "Change photo": "Alterar foto",
        "Find photo": "Procurar foto",
        "Creating illustration…": "Criando ilustração…",
        "Generate illustration": "Gerar ilustração",
        "Photo choices for ": "Opções de foto para ",
        "Use ": "Usar ",
        "This board is ready for its first card.": "Este quadro está pronto para receber o primeiro cartão.",
        "Kiwi is preparing the first cards…": "O Kiwi está preparando os primeiros cartões…",
        "Add a card here or ask Kiwi to fill the board.": "Adicione um cartão aqui ou peça ao Kiwi para preencher o quadro.",
        "End Kiwi voice conversation": "Encerrar conversa por voz com o Kiwi",
        "Talk to Kiwi": "Conversar com o Kiwi",
        "Opening…": "Abrindo…",
        "Creating…": "Criando…",
        "Open saved board": "Abrir quadro salvo",
        "Create board": "Criar quadro",
        "Reader": "Leitor",
        "Personal Plus": "Personal Plus",
        "Professional": "Profissional",
        "Professional plan": "Plano profissional",
        "Not available": "Indisponível",
        "Teams & organizations": "Equipes e organizações",
        "More seats": "Mais usuários",
        "Create free account": "Criar conta gratuita",
        "Upgrade personal": "Mudar para o Personal Plus",
        "Go professional": "Escolher plano Profissional",
        "Contact us": "Fale conosco",
        "Follow public city and topic wikis": "Acompanhe wikis públicos sobre cidades e temas",
        "Save favorite pages and source links": "Salve páginas favoritas e links das fontes",
        "Create narrated Stack videos with included voices": "Crie vídeos narrados no Stack com as vozes incluídas",
        "Start one personal LivingWiki draft": "Comece um rascunho pessoal no LivingWiki",
        "Up to 5 private LivingWiki spaces": "Até 5 espaços privados no LivingWiki",
        "Document uploads and cited answers": "Envio de documentos e respostas com citações",
        "Personal library across cities and topics": "Biblioteca pessoal de cidades e temas",
        "Create a reusable Personal Voice narrator": "Crie uma voz de narração pessoal reutilizável",
        "Public topic page publishing": "Publique páginas sobre temas públicos",
        "Custom landing page summary and media": "Personalize o resumo e a mídia da página inicial",
        "Source library and update workflow": "Biblioteca de fontes e fluxo de atualizações",
        "Basic visitor and question insights": "Dados básicos sobre visitantes e perguntas",
        "Talking Avatars available as an add-on": "Avatares conversacionais disponíveis como complemento",
        "Flexible pricing for additional seats": "Preços flexíveis para usuários adicionais",
        "Shared publishing and collaboration workflows": "Publicação compartilhada e trabalho em equipe",
        "Guided onboarding for your team": "Orientação para começar com sua equipe",
        "Priority support and rollout planning": "Suporte prioritário e planejamento de implementação",
        "Flexible plans for growing teams": "Planos flexíveis para equipes em crescimento",
        "free to start": "grátis para começar",
        "per month, billed annually": "por mês, cobrado anualmente",
        "per month": "por mês",
        "{$INTERPOLATION} pending": "{$INTERPOLATION} pendentes",
        "Verify {$INTERPOLATION}": "Confirmar {$INTERPOLATION}",
        "Set voice": "Definir voz",
        "Edit Talking Card & avatar": "Editar Talking Card e avatar",
        "AI Wiki Wizard": "Assistente de Wiki com IA",
        " views, ": " visualizações, ",
        "Browse all universities": "Explorar todas as universidades",
        "Browse all cities": "Explorar todas as cidades",
        "Search public boards": "Pesquisar quadros públicos",
        "No matching boards": "Nenhum quadro encontrado",
        "Searching more boards…": "Pesquisando mais quadros…",
        "Review before saving · {$INTERPOLATION}": "Revise antes de salvar · {$INTERPOLATION}",
        "today": "hoje",
        "board": "quadro",
        "boards": "quadros",
        "card": "cartão",
        "cards": "cartões",
        "song": "música",
        "songs": "músicas",
        "stops": "paradas",
        "photo": "foto",
        "photos": "fotos",
        "sentence": "frase",
        "sentences": "frases",
        "voice": "voz",
        "voices": "vozes",
        "image": "imagem",
        "images": "imagens",
        "warning": "aviso",
        "warnings": "avisos",
        "match": "resultado",
        "matches": "resultados",
        "universities": "universidades",
        "cities": "cidades",
        "rental": "aluguel",
        "property": "imóvel",
        "Warm, bright, and easy to talk to": "Acolhedora, animada e fácil de conversar",
        "Gentle, thoughtful, and expressive": "Suave, atenciosa e expressiva",
        "Poised, clear, with a British accent": "Elegante, clara e com sotaque britânico",
        "Calm, friendly, and direct": "Calma, amigável e direta",
        "Save": "Salvar",
        "Delete": "Excluir",
        "Edit": "Editar",
        "Share": "Compartilhar",
        "Cancel": "Cancelar",
        "Close": "Fechar",
        "Open": "Abrir",
        "Search": "Pesquisar",
        "Continue": "Continuar",
        "Done": "Concluído",
        "Add": "Adicionar",
        "Create": "Criar",
        "Remove": "Remover",
        "View": "Ver",
        "Copy": "Copiar",
        "Apply": "Aplicar",
        "Upload": "Enviar arquivo",
        "Download": "Baixar",
        "Settings": "Configurações",
        "Next": "Próximo",
        "Back": "Voltar",
        "Try again": "Tentar novamente",
        "Sign out": "Sair",
        "Close video": "Fechar vídeo",
        "Use Wiki": "Usar Wiki",
        "LivingWiki logo": "Logotipo do LivingWiki",
        "Tone": "Tom",
        "Config": "Configuração",
        "Snapshot status": "Status da captura",
        "Verified real square": "Quadrado real verificado",
        "The Nutrition & Diet Science Wiki": "Wiki de Nutrição e Ciência da Dieta",
        "Top scores": "Melhores pontuações",
        "{$START_TAG_SPAN}01{$CLOSE_TAG_SPAN} Key Takeaways": "{$START_TAG_SPAN}01{$CLOSE_TAG_SPAN} Principais conclusões",
        " Explore": " Explorar",
        "Quiz leaderboard": "Classificação do quiz",
        "Vibe": "Estilo",
        "Swipe cards": "Deslize pelos cartões",
        "Persona prompt": "Instruções da persona",
        "LivingWiki menu": "Menu do LivingWiki",
        "PinTalk by ": "PinTalk por ",
        "A LivingWiki Arcade": "Um arcade do LivingWiki",
        "Chester hub": "Centro de Chester",
        "Stack CTA": "Chamada para ação da pilha",
        "LivingWiki: Philly (Flagship)": "LivingWiki: Philly (principal)",
        "Portugues": "Português",
        "Espanol": "Espanhol",
        "Twilio SMS webhook": "Webhook de SMS da Twilio",
        "Copy link": "Copiar link",
        "Copy question": "Copiar pergunta",
        "Copy board link": "Copiar link do quadro",
        "Copy quiz link": "Copiar link do quiz",
        "Private board": "Quadro privado",
        "Saved Boards": "Quadros salvos",
        "Boards": "Quadros",
        "Open boards": "Abrir quadros",
        "Open my boards": "Abrir meus quadros",
        "Share board": "Compartilhar quadro",
        "Board owner": "Dono do quadro",
        "Board save failed. Please try again.": "Não foi possível salvar o quadro. Tente novamente.",
        "SuprrrJuke song board": "Quadro de músicas SuprrrJuke",
        "Loading Stack": "Carregando Stack",
        "A LivingWiki Stack": "Um Stack do LivingWiki",
        "Stack progress": "Progresso do Stack",
        "Image URL fallback": "URL alternativa da imagem",
        "Logo URL fallback": "URL alternativa do logotipo",
        "Public Wiki": "Wiki pública",
        "Wiki not found": "Wiki não encontrada",
        "Open friend profile": "Abrir perfil do amigo",
        "End voice mode": "Encerrar modo de voz",
        "Atlas | LivingWiki": "Atlas | LivingWiki",
        "Boards | LivingWiki": "Quadros | LivingWiki",
        " Keep it private ": " Manter privado ",
        "Create a LivingWiki": "Criar um LivingWiki",
        "Public knowledge, made living": "Conhecimento público que ganha vida",
        "Find what{$LINE_BREAK}lights you up.": "Encontre o que{$LINE_BREAK}inspira você.",
        "Ask a city. Explore a campus. Discover the boards people make about the places and ideas they know.": "Pergunte sobre uma cidade. Explore uma universidade. Descubra os quadros que as pessoas criam sobre os lugares e as ideias que conhecem.",
        "Explore LivingWiki": "Explore o LivingWiki",
        "See how it works": "Veja como funciona",
        "Featured LivingWiki pages": "Páginas em destaque do LivingWiki",
        "Search cities, universities, neighborhoods, and public LivingWiki pages...": "Pesquise cidades, universidades, bairros e páginas públicas do LivingWiki...",
        "Primary navigation": "Navegação principal",
        "For business": "Para empresas",
        "Pricing": "Planos",
        "Explore": "Explorar",
        "Map": "Mapa",
        "New board": "Novo quadro",
        "New card": "Novo cartão",
        "What should this board be about? Describe it in a sentence.": "Sobre o que deve ser este quadro? Descreva em uma frase.",
        "Should this board be Public, Unlisted, or Private?": "Este quadro deve ser público, não listado ou privado?",
        "Researching your description and building the board…": "Pesquisando sua descrição e montando o quadro…",
        "Describe it did not produce usable cards. Please try again.": "A descrição não gerou cartões utilizáveis. Tente novamente.",
        "This description needs more than 12 cards. Open Describe it in the board wizard to create the full set.": "Esta descrição precisa de mais de 12 cartões. Abra Descrever no assistente de quadros para criar o conjunto completo.",
        "Checking card images…": "Verificando as imagens dos cartões…",
        "Kiwi could not prepare this board for review. Please try again.": "O Kiwi não conseguiu preparar este quadro para revisão. Tente novamente.",
        "Wiki admin": "Administração da Wiki",
        "Clicks": "Cliques",
        "Explore {$START_TAG_SPAN}⌄{$CLOSE_TAG_SPAN}": "Explorar {$START_TAG_SPAN}⌄{$CLOSE_TAG_SPAN}",
        "Flip": "Virar",
        "{$START_TAG_CODE}[City]{$CLOSE_TAG_CODE} and {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE} both work. Some approved global titles intentionally omit the city.": "{$START_TAG_CODE}[City]{$CLOSE_TAG_CODE} e {$START_TAG_CODE}{$INTERPOLATION}{$CLOSE_TAG_CODE} funcionam. Alguns títulos globais aprovados omitem o nome da cidade de propósito.",
    },
}


# Legal copy needs a meaning-preserving translation rather than isolated
# sentence-level machine output.
MANUAL_OVERRIDES["pt-BR"].update({
    "Privacy": "Privacidade",
    "Terms": "Termos",
    "Last updated April 18, 2026": "Última atualização: 18 de abril de 2026",
    "What we collect": "O que coletamos",
    "How we use information": "Como usamos as informações",
    "Public atlas behavior": "Funcionamento dos atlas públicos",
    "Sharing and service providers": "Compartilhamento e prestadores de serviços",
    "Retention and security": "Retenção e segurança",
    "Your choices": "Suas escolhas",
    "Product ownership": "Titularidade do produto",
    "Using the service": "Uso do serviço",
    "Your content": "Seu conteúdo",
    "Public atlases and chats": "Atlas e conversas públicos",
    "Acceptable use": "Uso permitido",
    "AI output and product changes": "Conteúdo gerado por IA e mudanças no produto",
    "Disclaimers and liability": "Isenções e responsabilidade",
    "LivingWiki helps people upload documents, build atlas pages, and chat with knowledge derived from those materials. This page explains, in plain language, what information the product currently handles and why.": "O LivingWiki permite enviar documentos, criar páginas de atlas e conversar sobre o conhecimento extraído desses materiais. Esta página explica, em linguagem simples, quais informações o produto trata atualmente e por quê.",
    "We collect account information such as name, email address, authentication details, and basic profile metadata needed to operate the workspace.": "Coletamos informações da conta, como nome, endereço de e-mail, dados de autenticação e metadados básicos do perfil necessários para operar o espaço de trabalho.",
    "We store the content you upload or submit, including files, URLs, extracted text, generated wiki content, chat threads, and source citations tied to your atlas.": "Armazenamos o conteúdo que você envia, incluindo arquivos, URLs, texto extraído, conteúdo wiki gerado, conversas e citações de fontes vinculadas ao seu atlas.",
    "For public atlas pages, we also store public chat activity. Anonymous visitors are tracked with a browser-level anonymous identifier, and signed-in non-owners may have their name and email stored with the questions they ask.": "Nas páginas públicas de atlas, também armazenamos a atividade das conversas públicas. Visitantes anônimos são identificados por um identificador anônimo no navegador. Para usuários conectados que não são proprietários, o nome e o e-mail podem ser armazenados junto com as perguntas feitas.",
    "We use your information to authenticate users, process uploaded materials, generate wiki pages, answer chat questions, show citations, and maintain atlas history.": "Usamos suas informações para autenticar usuários, processar materiais enviados, gerar páginas wiki, responder a perguntas nas conversas, exibir citações e manter o histórico dos atlas.",
    "We also use operational logs and product telemetry to debug failures, improve reliability, prevent abuse, and understand how the product is being used.": "Também usamos registros operacionais e telemetria do produto para investigar falhas, melhorar a confiabilidade, prevenir abusos e entender como o produto é utilizado.",
    "If an atlas owner marks an atlas as public, visitors may be able to browse the atlas landing page, source files, wiki, and other public surfaces without signing in.": "Se o proprietário tornar um atlas público, visitantes poderão acessar sua página inicial, arquivos de origem, wiki e outras áreas públicas sem entrar na conta.",
    "Public chats are visible to the service operators and may later be visible to the relevant atlas owner inside the product. Owners should only publish atlases they are comfortable exposing in read-only form.": "As conversas públicas são visíveis aos operadores do serviço e, futuramente, também poderão ser visíveis ao proprietário do atlas correspondente dentro do produto. Os proprietários devem publicar apenas atlas que estejam confortáveis em disponibilizar para consulta.",
    "We may use infrastructure, hosting, storage, authentication, analytics, and model providers to operate LivingWiki. Those providers may process data strictly to deliver the service on our behalf.": "Podemos utilizar fornecedores de infraestrutura, hospedagem, armazenamento, autenticação, análise e modelos para operar o LivingWiki. Esses fornecedores podem tratar dados estritamente para prestar o serviço em nosso nome.",
    "We do not sell personal information. We may disclose information when required by law, to enforce our terms, or to protect the product, users, or the public.": "Não vendemos informações pessoais. Podemos divulgar informações quando a lei exigir, para fazer cumprir nossos termos ou para proteger o produto, os usuários ou o público.",
    "We retain information for as long as it is needed to provide the service, maintain workspace history, comply with legal obligations, and resolve disputes.": "Mantemos as informações pelo tempo necessário para prestar o serviço, preservar o histórico do espaço de trabalho, cumprir obrigações legais e resolver disputas.",
    "We use reasonable administrative, technical, and organizational safeguards, but no online system can guarantee absolute security.": "Adotamos medidas administrativas, técnicas e organizacionais razoáveis de proteção, mas nenhum sistema on-line pode garantir segurança absoluta.",
    "Atlas owners can remove documents and chats from their workspace where product controls allow it. Public visitors can stop using the service at any time.": "Os proprietários de atlas podem remover documentos e conversas de seus espaços de trabalho quando os controles do produto permitirem. Visitantes públicos podem deixar de usar o serviço a qualquer momento.",
    "We may revise this policy as the product evolves. When we do, we will update the text on this page and change the effective date above.": "Podemos revisar esta política conforme o produto evoluir. Quando isso ocorrer, atualizaremos o texto desta página e a data de vigência acima.",
    "These terms are a practical starting point for using LivingWiki. They are intentionally concise for now and will be refined as the product matures.": "Estes termos são um ponto de partida prático para usar o LivingWiki. Por enquanto, são intencionalmente concisos e serão aprimorados conforme o produto amadurecer.",
    "LivingWiki™ is a product of Mind Palace Inc.": "LivingWiki™ é um produto da Mind Palace Inc.",
    "LivingWiki is an independent product of Mind Palace Inc. and is not affiliated with, endorsed by, or sponsored by the Wikimedia Foundation, Wikipedia, or any related Wikimedia project.": "O LivingWiki é um produto independente da Mind Palace Inc. e não possui vínculo, endosso ou patrocínio da Wikimedia Foundation, da Wikipedia ou de qualquer projeto relacionado à Wikimedia.",
    "By accessing or using LivingWiki, you agree to use the product lawfully and responsibly. If you do not agree, do not use the service.": "Ao acessar ou usar o LivingWiki, você concorda em utilizar o produto de forma legal e responsável. Se não concordar, não use o serviço.",
    "You are responsible for your account, your atlas settings, and the activity that occurs under your credentials.": "Você é responsável por sua conta, pelas configurações de seus atlas e pelas atividades realizadas com suas credenciais.",
    "You keep ownership of the content you upload or submit. You give LivingWiki permission to host, process, transform, index, and display that content as needed to operate the product.": "Você mantém a titularidade do conteúdo que envia. Você concede ao LivingWiki permissão para hospedar, processar, transformar, indexar e exibir esse conteúdo conforme necessário para operar o produto.",
    "You are responsible for making sure you have the rights to upload, publish, and share the material you place into the service.": "Você é responsável por garantir que possui os direitos necessários para enviar, publicar e compartilhar os materiais que disponibiliza no serviço.",
    "If you make an atlas public, you are responsible for the materials and generated content exposed through that atlas.": "Se você tornar um atlas público, será responsável pelos materiais e pelo conteúdo gerado disponibilizados por meio dele.",
    "Public visitors may be allowed to ask questions against a public atlas. Those interactions may be logged and associated with anonymous identifiers or signed-in visitor account details.": "Visitantes públicos poderão fazer perguntas a um atlas público. Essas interações poderão ser registradas e associadas a identificadores anônimos ou aos dados da conta de visitantes conectados.",
    "You may not use LivingWiki to violate the law, infringe intellectual property or privacy rights, distribute harmful material, interfere with the service, or attempt unauthorized access.": "Você não pode usar o LivingWiki para violar a lei, infringir direitos de propriedade intelectual ou privacidade, distribuir material prejudicial, interferir no serviço ou tentar obter acesso não autorizado.",
    "We may suspend or terminate access if we reasonably believe your use creates security, legal, operational, or abuse risks.": "Podemos suspender ou encerrar o acesso se acreditarmos razoavelmente que seu uso cria riscos de segurança, jurídicos, operacionais ou de abuso.",
    "LivingWiki may generate summaries, wiki pages, citations, and chat answers using automated systems. Those outputs can be incomplete or incorrect and should be reviewed before being relied on.": "O LivingWiki pode gerar resumos, páginas wiki, citações e respostas a conversas por meio de sistemas automatizados. Esses resultados podem estar incompletos ou incorretos e devem ser revisados antes de serem utilizados como base para decisões.",
    "LivingWiki answers are generated from available source material, public information, uploaded documents, verified local sources, and user-submitted updates, and may require human review.": "As respostas do LivingWiki são geradas a partir de materiais de origem disponíveis, informações públicas, documentos enviados, fontes locais verificadas e atualizações fornecidas por usuários, e podem exigir revisão humana.",
    "We may change, improve, limit, or discontinue features at any time, including public atlas behavior, storage limits, or usage controls.": "Podemos alterar, aprimorar, limitar ou descontinuar recursos a qualquer momento, inclusive o funcionamento dos atlas públicos, os limites de armazenamento e os controles de uso.",
    "LivingWiki is provided on an as-is and as-available basis without warranties of any kind, to the fullest extent permitted by law.": "O LivingWiki é fornecido no estado em que se encontra e conforme sua disponibilidade, sem garantias de qualquer tipo, na máxima medida permitida por lei.",
    "To the fullest extent permitted by law, we are not liable for indirect, incidental, special, consequential, or punitive damages, or for loss of data, profits, or business arising from use of the service.": "Na máxima medida permitida por lei, não nos responsabilizamos por danos indiretos, incidentais, especiais, consequenciais ou punitivos, nem por perda de dados, lucros ou negócios decorrentes do uso do serviço.",
})

def translate_piece(piece: str, target: str, cache: dict[str, str]) -> str:
    if not LETTER.search(piece):
        return piece

    leading = piece[: len(piece) - len(piece.lstrip())]
    trailing = piece[len(piece.rstrip()) :]
    core = piece.strip()
    if not core:
        return piece

    protected_parts = PROTECTED.split(core)
    translated_parts: list[str] = []
    for part in protected_parts:
        if not part:
            continue
        if PROTECTED.fullmatch(part):
            translated_parts.append(part)
            continue
        if not LETTER.search(part):
            translated_parts.append(part)
            continue
        part_leading = part[: len(part) - len(part.lstrip())]
        part_trailing = part[len(part.rstrip()) :]
        part_core = part.strip()
        if part_core not in cache:
            cache[part_core] = translate.translate(part_core, "en", target)
        translated_parts.append(f"{part_leading}{cache[part_core]}{part_trailing}")
    return f"{leading}{''.join(translated_parts)}{trailing}"


def translate_message(message: str, target: str, cache: dict[str, str]) -> str:
    parts = PLACEHOLDER.split(message)
    translated_parts = []
    for index, part in enumerate(parts):
        icon_between_tags = (
            part.strip() in ICON_NAMES
            and index > 0
            and index + 1 < len(parts)
            and parts[index - 1].startswith("{$START_TAG_")
            and parts[index + 1].startswith("{$CLOSE_TAG_")
        )
        translated_parts.append(
            part if PLACEHOLDER.fullmatch(part) or icon_between_tags
            else translate_piece(part, target, cache)
        )
    return "".join(translated_parts)


def placeholders(message: str) -> list[str]:
    return PLACEHOLDER.findall(message)


def manual_override(message: str, target: str) -> str | None:
    exact = MANUAL_OVERRIDES[target].get(message)
    if exact is not None:
        return exact
    leading = message[: len(message) - len(message.lstrip())]
    trailing = message[len(message.rstrip()) :]
    translated = MANUAL_OVERRIDES[target].get(message.strip())
    return None if translated is None else f"{leading}{translated}{trailing}"


def normalize_product_terms(source: str, translated: str, target: str) -> str:
    if target != "pt-BR" or not re.search(r"\bboards?\b", source, re.IGNORECASE):
        return translated

    # A LivingWiki board is a digital collection of cards. The general-purpose
    # model also calls it a council, plank, or sign, which is misleading here.
    replacements = {
        "conselho": "quadro", "tabuleiro": "quadro", "tábua": "quadro",
        "placa": "quadro", "prancha": "quadro", "board": "quadro",
        "conselhos": "quadros", "tabuleiros": "quadros", "tábuas": "quadros",
        "placas": "quadros", "pranchas": "quadros", "boards": "quadros",
    }

    def replace_noun(match: re.Match[str]) -> str:
        word = match.group(0)
        replacement = replacements[word.lower()]
        return replacement.capitalize() if word[0].isupper() else replacement

    result = re.sub(
        r"\b(?:conselhos?|tabuleiros?|tábuas?|placas?|pranchas?|boards?)\b",
        replace_noun,
        translated,
        flags=re.IGNORECASE,
    )
    result = re.sub(
        r"\b([Qq]uadros?) (privadas|públicas|salvas|abertas|compartilhadas|novas)\b",
        lambda match: f"{match.group(1)} {match.group(2)[:-2]}os",
        result,
        flags=re.IGNORECASE,
    )
    result = re.sub(
        r"\b([Qq]uadro) (privada|pública|salva|aberta|compartilhada|nova)\b",
        lambda match: f"{match.group(1)} {match.group(2)[:-1]}o",
        result,
        flags=re.IGNORECASE,
    )
    return result


def main() -> None:
    if len(sys.argv) != 2 or sys.argv[1] not in TARGETS:
        raise SystemExit("usage: translate-angular-catalog.py <fr|ja|pt-BR>")

    target = sys.argv[1]
    locale, output_path = TARGETS[target]
    source = json.loads(SOURCE_PATH.read_text())
    source_messages: dict[str, str] = source["translations"]
    existing = json.loads(output_path.read_text())["translations"] if output_path.exists() else {}
    cache_path = Path(f"/tmp/livingwiki-translation-cache-{target}.json")
    cache = json.loads(cache_path.read_text()) if cache_path.exists() else {}
    translated: dict[str, str] = {}

    for index, (message_id, message) in enumerate(source_messages.items(), start=1):
        target_message = manual_override(message, target) or existing.get(message_id) or translate_message(message, locale, cache)
        target_message = normalize_product_terms(message, target_message, target)
        if placeholders(target_message) != placeholders(message):
            raise RuntimeError(f"Placeholder mismatch for {message_id}: {message!r} -> {target_message!r}")
        translated[message_id] = target_message
        if index % 100 == 0:
            cache_path.write_text(json.dumps(cache, ensure_ascii=False))
            print(f"{target}: translated {index}/{len(source_messages)} messages", flush=True)

    output_path.write_text(
        json.dumps({"locale": target, "translations": translated}, ensure_ascii=False, indent=2) + "\n"
    )
    cache_path.write_text(json.dumps(cache, ensure_ascii=False))
    print(f"{target}: wrote {len(translated)} messages to {output_path}", flush=True)


if __name__ == "__main__":
    main()
