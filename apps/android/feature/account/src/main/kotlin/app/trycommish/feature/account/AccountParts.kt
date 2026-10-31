package app.trycommish.feature.account

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.LinkAnnotation
import androidx.compose.ui.text.SpanStyle
import androidx.compose.ui.text.TextLinkStyles
import androidx.compose.ui.text.buildAnnotatedString
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.withLink
import androidx.compose.ui.unit.dp
import app.trycommish.core.account.AccountModel
import app.trycommish.core.account.PlanCard
import app.trycommish.core.shell.SiteLinks
import app.trycommish.design.CommishTheme
import app.trycommish.design.Faces
import app.trycommish.design.QuietButton
import app.trycommish.design.Tokens
import app.trycommish.design.Words
import app.trycommish.feature.boxscore.BasisText
import app.trycommish.feature.boxscore.Hairline

/** A section's head as the iOS Account draws it: the name in the number face, uppercase, and what it
 * holds under it. */
@Composable
internal fun SectionHead(
    title: String,
    aside: String? = null,
) {
    val c = CommishTheme.colors
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(2.dp)) {
        Text(title.uppercase(), style = Faces.head, color = c.ink, modifier = Modifier.semantics { heading() })
        aside?.let { Text(it, style = Faces.small, color = c.ink2) }
    }
}

/** The account's name, the line under it, and sign out beside them (AccountPage.svelte .who). */
@Composable
internal fun WhoView(
    model: AccountModel,
    stamp: String?,
    busy: Boolean,
    signOut: () -> Unit,
) {
    val c = CommishTheme.colors
    Row(verticalAlignment = Alignment.Bottom, horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s4.dp)) {
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(2.dp)) {
            Text(model.name.uppercase(), style = Faces.head, color = c.ink, modifier = Modifier.semantics { heading() })
            Text(model.line, style = Faces.small, color = c.ink2)
            stamp?.let { Text(it, style = Faces.label.copy(letterSpacing = Faces.small.letterSpacing), color = c.accentText) }
        }
        SignOutButton(busy, signOut)
    }
}

/** Sign out, the account's way off this phone; held while an action is under way. */
@Composable
internal fun SignOutButton(
    busy: Boolean,
    onClick: () -> Unit,
) {
    QuietButton(Words.Account.signOut, enabled = !busy, onClick = onClick)
}

/** The plan in the free season (AccountPage.svelte's Plan section): its title, its line, and the way to
 * what is free. */
@Composable
internal fun PlanView(
    plan: PlanCard,
    openLink: (String) -> Unit,
) {
    val c = CommishTheme.colors
    Column(verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        SectionHead(Words.Account.plan)
        KeyRow(trailing = { QuietButton(plan.see) { openLink(SiteLinks.PASS) } }) {
            Column(verticalArrangement = Arrangement.spacedBy(2.dp)) {
                Text(plan.title, style = Faces.body.copy(fontWeight = FontWeight.Bold), color = c.ink)
                Text(plan.line, style = Faces.small, color = c.ink2)
            }
        }
    }
}

/** A row of the web's key-value panels (.kvr): what it is on the left, its control on the right, a
 * hairline under it. */
@Composable
internal fun KeyRow(
    trailing: @Composable RowScope.() -> Unit,
    leading: @Composable () -> Unit,
) {
    Column {
        Row(
            Modifier.fillMaxWidth().padding(vertical = Tokens.Space.s2.dp),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(Tokens.Space.s3.dp),
        ) {
            Column(Modifier.weight(1f)) { leading() }
            trailing()
        }
        Hairline()
    }
}

/** An action's failure, said under its list (web ProblemLine.svelte), read out as it appears. */
@Composable
internal fun ProblemText(text: String) {
    Text(
        text,
        style = Faces.small.copy(fontWeight = FontWeight.SemiBold),
        color = CommishTheme.colors.lossInk,
        modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
    )
}

/** The page's foot (AccountFoot.svelte): the quiet Delete account verb, which opens the confirmation
 * dialog, then the two legal pages, each link the site's and each its own TalkBack stop, and the
 * not-affiliated line beside them (Lane 310). */
@Composable
internal fun AccountFoot(
    deleteAccount: () -> Unit,
    openLink: (String) -> Unit,
) {
    val c = CommishTheme.colors
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(Tokens.Space.s2.dp)) {
        QuietButton(Words.AccountDeleteFoot.verb, onClick = deleteAccount)
        Text(
            foot(c.accentText, openLink),
            style = Faces.small,
            color = c.ink3,
            modifier = Modifier.fillMaxWidth(),
        )
        BasisText(Words.NotAffiliated.line)
    }
}

private fun foot(
    linkColor: androidx.compose.ui.graphics.Color,
    openLink: (String) -> Unit,
): AnnotatedString {
    val words = Words.AccountFoot
    val styles = TextLinkStyles(SpanStyle(color = linkColor))
    return buildAnnotatedString {
        fun link(
            text: String,
            url: String,
        ) = withLink(LinkAnnotation.Clickable(url, styles) { openLink(url) }) { append(text) }
        append(Words.AccountDeleteFoot.keep)
        link(words.privacy, SiteLinks.PRIVACY)
        append(words.joint)
        link(words.terms, SiteLinks.TERMS)
        append(words.end)
    }
}
