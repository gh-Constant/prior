package mailer

import (
	"bytes"
	"fmt"
	"html/template"
	"strings"
)

// Kind is the type of account email.
type Kind string

const (
	KindPasswordReset Kind = "password_reset"
	KindVerifyEmail   Kind = "verify_email"
	KindProjectInvite Kind = "project_invite"
)

// Languages lists the locales emails are written in (same as the app).
var Languages = []string{"en", "fr", "de", "es", "pt"}

type copyText struct {
	Subject  string
	Preview  string
	Heading  string
	Intro    string
	Button   string
	Fallback string
	Expiry   string
	Ignore   string
	Footer   string
}

var texts = map[Kind]map[string]copyText{
	KindPasswordReset: {
		"en": {
			Subject: "Reset your Prior password", Preview: "Choose a new password for your Prior account.",
			Heading: "Reset your password", Intro: "Someone asked to reset the password of the Prior account {email}. Choose a new one with the button below.",
			Button: "Choose a new password", Fallback: "If the button does not work, copy this link into your browser:",
			Expiry: "This link works once and expires in 30 minutes. Resetting your password signs you out on every device.",
			Ignore: "Didn't ask for this? You can ignore this email, your password stays the same.", Footer: "Prior · Decide what deserves your attention.",
		},
		"fr": {
			Subject: "Réinitialisez votre mot de passe Prior", Preview: "Choisissez un nouveau mot de passe pour votre compte Prior.",
			Heading: "Réinitialiser votre mot de passe", Intro: "Une demande de réinitialisation du mot de passe du compte Prior {email} a été faite. Choisissez-en un nouveau avec le bouton ci-dessous.",
			Button: "Choisir un nouveau mot de passe", Fallback: "Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :",
			Expiry: "Ce lien ne fonctionne qu’une fois et expire dans 30 minutes. La réinitialisation vous déconnecte de tous vos appareils.",
			Ignore: "Vous n’êtes pas à l’origine de cette demande ? Ignorez cet e-mail, votre mot de passe ne change pas.", Footer: "Prior · Décidez de ce qui mérite votre attention.",
		},
		"de": {
			Subject: "Setze dein Prior-Passwort zurück", Preview: "Wähle ein neues Passwort für dein Prior-Konto.",
			Heading: "Passwort zurücksetzen", Intro: "Für das Prior-Konto {email} wurde das Zurücksetzen des Passworts angefordert. Wähle mit der Schaltfläche unten ein neues.",
			Button: "Neues Passwort wählen", Fallback: "Falls die Schaltfläche nicht funktioniert, kopiere diesen Link in deinen Browser:",
			Expiry: "Dieser Link funktioniert einmal und läuft nach 30 Minuten ab. Nach dem Zurücksetzen wirst du auf allen Geräten abgemeldet.",
			Ignore: "Nicht von dir angefordert? Ignoriere diese E-Mail, dein Passwort bleibt unverändert.", Footer: "Prior · Entscheide, was deine Aufmerksamkeit verdient.",
		},
		"es": {
			Subject: "Restablece tu contraseña de Prior", Preview: "Elige una nueva contraseña para tu cuenta de Prior.",
			Heading: "Restablecer tu contraseña", Intro: "Se ha pedido restablecer la contraseña de la cuenta de Prior {email}. Elige una nueva con el botón de abajo.",
			Button: "Elegir una nueva contraseña", Fallback: "Si el botón no funciona, copia este enlace en tu navegador:",
			Expiry: "Este enlace funciona una sola vez y caduca en 30 minutos. Al restablecerla se cerrará la sesión en todos tus dispositivos.",
			Ignore: "¿No lo has pedido tú? Ignora este correo, tu contraseña no cambia.", Footer: "Prior · Decide qué merece tu atención.",
		},
		"pt": {
			Subject: "Redefina sua senha do Prior", Preview: "Escolha uma nova senha para sua conta do Prior.",
			Heading: "Redefinir sua senha", Intro: "Foi solicitada a redefinição da senha da conta do Prior {email}. Escolha uma nova com o botão abaixo.",
			Button: "Escolher uma nova senha", Fallback: "Se o botão não funcionar, copie este link no seu navegador:",
			Expiry: "Este link funciona uma vez e expira em 30 minutos. Redefinir a senha encerra sua sessão em todos os dispositivos.",
			Ignore: "Não foi você? Ignore este e-mail, sua senha continua a mesma.", Footer: "Prior · Decida o que merece sua atenção.",
		},
	},
	KindVerifyEmail: {
		"en": {
			Subject: "Confirm your email for Prior", Preview: "One click to confirm your email address.",
			Heading: "Confirm your email", Intro: "Confirm that {email} is your address so you can recover your Prior account if you forget your password.",
			Button: "Confirm my email", Fallback: "If the button does not work, copy this link into your browser:",
			Expiry: "This link works once and expires in 24 hours.",
			Ignore: "Didn't create a Prior account? You can ignore this email.", Footer: "Prior · Decide what deserves your attention.",
		},
		"fr": {
			Subject: "Confirmez votre e-mail pour Prior", Preview: "Un clic pour confirmer votre adresse e-mail.",
			Heading: "Confirmez votre e-mail", Intro: "Confirmez que {email} est bien votre adresse pour pouvoir récupérer votre compte Prior si vous oubliez votre mot de passe.",
			Button: "Confirmer mon e-mail", Fallback: "Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :",
			Expiry: "Ce lien ne fonctionne qu’une fois et expire dans 24 heures.",
			Ignore: "Vous n’avez pas créé de compte Prior ? Ignorez cet e-mail.", Footer: "Prior · Décidez de ce qui mérite votre attention.",
		},
		"de": {
			Subject: "Bestätige deine E-Mail für Prior", Preview: "Ein Klick, um deine E-Mail-Adresse zu bestätigen.",
			Heading: "Bestätige deine E-Mail", Intro: "Bestätige, dass {email} deine Adresse ist, damit du dein Prior-Konto wiederherstellen kannst, falls du dein Passwort vergisst.",
			Button: "E-Mail bestätigen", Fallback: "Falls die Schaltfläche nicht funktioniert, kopiere diesen Link in deinen Browser:",
			Expiry: "Dieser Link funktioniert einmal und läuft nach 24 Stunden ab.",
			Ignore: "Du hast kein Prior-Konto erstellt? Ignoriere diese E-Mail.", Footer: "Prior · Entscheide, was deine Aufmerksamkeit verdient.",
		},
		"es": {
			Subject: "Confirma tu correo para Prior", Preview: "Un clic para confirmar tu dirección de correo.",
			Heading: "Confirma tu correo", Intro: "Confirma que {email} es tu dirección para poder recuperar tu cuenta de Prior si olvidas tu contraseña.",
			Button: "Confirmar mi correo", Fallback: "Si el botón no funciona, copia este enlace en tu navegador:",
			Expiry: "Este enlace funciona una sola vez y caduca en 24 horas.",
			Ignore: "¿No has creado una cuenta de Prior? Ignora este correo.", Footer: "Prior · Decide qué merece tu atención.",
		},
		"pt": {
			Subject: "Confirme seu e-mail no Prior", Preview: "Um clique para confirmar seu endereço de e-mail.",
			Heading: "Confirme seu e-mail", Intro: "Confirme que {email} é seu endereço para poder recuperar sua conta do Prior se esquecer a senha.",
			Button: "Confirmar meu e-mail", Fallback: "Se o botão não funcionar, copie este link no seu navegador:",
			Expiry: "Este link funciona uma vez e expira em 24 horas.",
			Ignore: "Não criou uma conta no Prior? Ignore este e-mail.", Footer: "Prior · Decida o que merece sua atenção.",
		},
	},
	KindProjectInvite: {
		"en": {
			Subject: "{inviter} invited you to “{project}” on Prior", Preview: "Join the project to see its tasks and work together.",
			Heading: "Join “{project}”", Intro: "{inviter} invited {email} to work together on the project “{project}” in Prior.",
			Button: "Open the invitation", Fallback: "If the button does not work, copy this link into your browser:",
			Expiry: "This invitation expires in 7 days. Sign in or create a Prior account with this email address to join.",
			Ignore: "Not expecting this? You can ignore this email; nothing changes until you accept.", Footer: "Prior · Decide what deserves your attention.",
		},
		"fr": {
			Subject: "{inviter} vous invite sur « {project} » dans Prior", Preview: "Rejoignez le projet pour voir ses tâches et travailler ensemble.",
			Heading: "Rejoindre « {project} »", Intro: "{inviter} a invité {email} à collaborer sur le projet « {project} » dans Prior.",
			Button: "Voir l’invitation", Fallback: "Si le bouton ne fonctionne pas, copiez ce lien dans votre navigateur :",
			Expiry: "Cette invitation expire dans 7 jours. Connectez-vous ou créez un compte Prior avec cette adresse e-mail pour rejoindre le projet.",
			Ignore: "Vous ne vous attendiez pas à cet e-mail ? Ignorez-le : rien ne change tant que vous n’acceptez pas.", Footer: "Prior · Décidez de ce qui mérite votre attention.",
		},
		"de": {
			Subject: "{inviter} hat dich zu „{project}“ in Prior eingeladen", Preview: "Tritt dem Projekt bei, um seine Aufgaben zu sehen und gemeinsam zu arbeiten.",
			Heading: "„{project}“ beitreten", Intro: "{inviter} hat {email} eingeladen, in Prior am Projekt „{project}“ mitzuarbeiten.",
			Button: "Einladung öffnen", Fallback: "Falls die Schaltfläche nicht funktioniert, kopiere diesen Link in deinen Browser:",
			Expiry: "Diese Einladung läuft nach 7 Tagen ab. Melde dich mit dieser E-Mail-Adresse bei Prior an oder erstelle ein Konto, um beizutreten.",
			Ignore: "Nicht erwartet? Ignoriere diese E-Mail; es ändert sich nichts, solange du nicht annimmst.", Footer: "Prior · Entscheide, was deine Aufmerksamkeit verdient.",
		},
		"es": {
			Subject: "{inviter} te ha invitado a «{project}» en Prior", Preview: "Únete al proyecto para ver sus tareas y trabajar en equipo.",
			Heading: "Únete a «{project}»", Intro: "{inviter} ha invitado a {email} a colaborar en el proyecto «{project}» en Prior.",
			Button: "Ver la invitación", Fallback: "Si el botón no funciona, copia este enlace en tu navegador:",
			Expiry: "Esta invitación caduca en 7 días. Inicia sesión o crea una cuenta de Prior con esta dirección de correo para unirte.",
			Ignore: "¿No lo esperabas? Ignora este correo; nada cambia hasta que aceptes.", Footer: "Prior · Decide qué merece tu atención.",
		},
		"pt": {
			Subject: "{inviter} convidou você para “{project}” no Prior", Preview: "Entre no projeto para ver as tarefas e trabalhar em equipe.",
			Heading: "Entrar em “{project}”", Intro: "{inviter} convidou {email} para colaborar no projeto “{project}” no Prior.",
			Button: "Ver o convite", Fallback: "Se o botão não funcionar, copie este link no seu navegador:",
			Expiry: "Este convite expira em 7 dias. Entre ou crie uma conta do Prior com este endereço de e-mail para participar.",
			Ignore: "Não esperava por isso? Ignore este e-mail; nada muda até você aceitar.", Footer: "Prior · Decida o que merece sua atenção.",
		},
	},
}

// NormalizeLanguage maps any locale ("fr-FR", "PT") to a supported language.
func NormalizeLanguage(value string) string {
	value = strings.ToLower(strings.TrimSpace(value))
	if len(value) > 2 {
		value = value[:2]
	}
	for _, supported := range Languages {
		if value == supported {
			return value
		}
	}
	return "en"
}

var htmlTemplate = template.Must(template.New("email").Parse(`<!DOCTYPE html>
<html lang="{{.Lang}}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light dark">
<meta name="supported-color-schemes" content="light dark">
<title>{{.Subject}}</title>
<style>
  body { margin:0; padding:0; background:#f6f3ee; color:#1d1c1a; font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  .card { background:#ffffff; border:1px solid #ebe5dc; }
  .muted { color:#6b6760; }
  .link { color:#d4462b; word-break:break-all; }
  @media (prefers-color-scheme: dark) {
    body, .outer { background:#1b1a18 !important; color:#f3efe8 !important; }
    .card { background:#26241f !important; border-color:#3a3731 !important; }
    .muted { color:#b5afa5 !important; }
    .link { color:#ff9670 !important; }
    h1 { color:#f3efe8 !important; }
  }
</style>
</head>
<body>
<span style="display:none;max-height:0;overflow:hidden;opacity:0">{{.Preview}}</span>
<table role="presentation" class="outer" width="100%" cellpadding="0" cellspacing="0" style="background:#f6f3ee;padding:32px 12px">
<tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 18px;font-size:22px;font-weight:700;letter-spacing:-0.04em"><span style="color:#f35f43">&#9632;</span> Prior</td></tr>
<tr><td class="card" style="background:#ffffff;border:1px solid #ebe5dc;border-radius:16px;padding:32px 28px">
<h1 style="margin:0 0 14px;font-size:22px;line-height:1.3;color:#1d1c1a">{{.Heading}}</h1>
<p style="margin:0 0 24px;font-size:15px;line-height:1.6">{{.Intro}}</p>
<table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="border-radius:10px;background:#f35f43">
<a href="{{.Link}}" style="display:inline-block;padding:13px 22px;font-size:15px;font-weight:600;color:#ffffff;text-decoration:none;border-radius:10px">{{.Button}}</a>
</td></tr></table>
<p class="muted" style="margin:24px 0 6px;font-size:13px;line-height:1.5;color:#6b6760">{{.Fallback}}</p>
<p style="margin:0 0 20px;font-size:13px;line-height:1.5"><a class="link" href="{{.Link}}" style="color:#d4462b;word-break:break-all">{{.Link}}</a></p>
<p class="muted" style="margin:0 0 8px;font-size:13px;line-height:1.5;color:#6b6760">{{.Expiry}}</p>
<p class="muted" style="margin:0;font-size:13px;line-height:1.5;color:#6b6760">{{.Ignore}}</p>
</td></tr>
<tr><td class="muted" style="padding:18px 4px 0;font-size:12px;color:#6b6760">{{.Footer}}</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`))

// Render builds a localized message. link is the only dynamic URL.
func Render(kind Kind, language, to, link string) (Message, error) {
	return RenderWith(kind, language, to, link, nil)
}

// RenderWith is Render with extra {placeholders} (inviter, project, ...)
// replaced in the subject, preview, heading and intro. Values are plain
// text: the HTML template escapes them.
func RenderWith(kind Kind, language, to, link string, vars map[string]string) (Message, error) {
	byLang, ok := texts[kind]
	if !ok {
		return Message{}, fmt.Errorf("unknown email kind %q", kind)
	}
	language = NormalizeLanguage(language)
	copy := byLang[language]
	fill := func(value string) string {
		for key, replacement := range vars {
			value = strings.ReplaceAll(value, "{"+key+"}", replacement)
		}
		return value
	}
	copy.Subject, copy.Preview, copy.Heading = fill(copy.Subject), fill(copy.Preview), fill(copy.Heading)
	intro := strings.ReplaceAll(fill(copy.Intro), "{email}", to)
	var html bytes.Buffer
	err := htmlTemplate.Execute(&html, map[string]any{
		"Lang": language, "Subject": copy.Subject, "Preview": copy.Preview, "Heading": copy.Heading, "Intro": intro,
		"Button": copy.Button, "Fallback": copy.Fallback, "Expiry": copy.Expiry, "Ignore": copy.Ignore, "Footer": copy.Footer,
		"Link": template.URL(link),
	})
	if err != nil {
		return Message{}, err
	}
	text := strings.Join([]string{copy.Heading, "", intro, "", copy.Button + ": " + link, "", copy.Expiry, copy.Ignore, "", copy.Footer}, "\n")
	return Message{To: to, Subject: copy.Subject, HTML: html.String(), Text: text, Link: link}, nil
}
