package app.ryzik.chat.ui.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.OutlinedButton
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import app.ryzik.chat.RyzikApp
import app.ryzik.chat.data.User
import app.ryzik.chat.data.userMessage
import app.ryzik.chat.ui.components.Avatar
import kotlinx.coroutines.launch

/** Список заблокированных с возможностью разблокировать. */
@Composable
fun BlockedSection() {
    val repo = RyzikApp.instance.repo
    val scope = rememberCoroutineScope()
    var list by remember { mutableStateOf<List<User>?>(null) }
    LaunchedEffect(Unit) { list = runCatching { repo.api.blocks() }.getOrDefault(emptyList()) }
    val l = list ?: return
    if (l.isEmpty()) {
        Text(
            "Никого. Заблокировать можно в личном чате или профиле.",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
        )
    }
    l.forEach { u ->
        ListItem(
            headlineContent = { Text(u.displayName) },
            supportingContent = { Text("@${u.username}") },
            leadingContent = { Avatar(u.displayName, repo.avatarUrl(u.avatarFileId), 40.dp) },
            trailingContent = {
                TextButton(onClick = {
                    scope.launch { runCatching { repo.setBlocked(u.id, false) }.onSuccess { list = l.filterNot { it.id == u.id } } }
                }) { Text("Разблокировать") }
            },
        )
    }
}

/** Выбор шрифта эмодзи: встроенный набор или свой файл .ttf с телефона (например, iOS-эмодзи). */
@Composable
fun EmojiFontSection(enabled: Boolean) {
    val context = androidx.compose.ui.platform.LocalContext.current
    val scope = rememberCoroutineScope()
    var hasCustom by remember { mutableStateOf(app.ryzik.chat.ui.emoji.IosEmoji.hasCustom(context)) }
    var preview by remember { mutableStateOf(app.ryzik.chat.ui.emoji.IosEmoji.customTypeface(context)) }
    var busy by remember { mutableStateOf(false) }
    var message by remember { mutableStateOf<String?>(null) }
    var showHelp by remember { mutableStateOf(false) }
    val picker = androidx.activity.compose.rememberLauncherForActivityResult(
        androidx.activity.result.contract.ActivityResultContracts.OpenDocument(),
    ) { uri ->
        if (uri != null) {
            busy = true
            scope.launch {
                val err = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { app.ryzik.chat.ui.emoji.IosEmoji.importCustom(context, uri) }
                busy = false
                if (err == null) {
                    hasCustom = true
                    preview = app.ryzik.chat.ui.emoji.IosEmoji.customTypeface(context)
                    message = "Шрифт загружен. Перезапустите приложение, чтобы эмодзи поменялись везде."
                } else message = err
            }
        }
    }
    ListItem(
        headlineContent = { Text("Шрифт эмодзи") },
        supportingContent = {
            Column {
                Text(if (hasCustom) "Свой файл с телефона" else "Встроенный набор (Fluent 3D)")
                val tf = preview
                if (hasCustom && tf != null) {
                    Text(
                        "😀😂😍👍🔥❤️🥳🙏",
                        fontFamily = androidx.compose.ui.text.font.FontFamily(androidx.compose.ui.text.font.Typeface(tf)),
                        fontSize = 26.sp,
                        modifier = Modifier.padding(top = 6.dp),
                    )
                }
            }
        },
        leadingContent = { Text("😀", fontSize = 28.sp) },
        trailingContent = { if (busy) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp) },
        modifier = Modifier.clickable(enabled = enabled && !busy) { picker.launch(arrayOf("font/ttf", "font/*", "application/x-font-ttf", "application/octet-stream", "*/*")) },
    )
    Row(Modifier.padding(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        OutlinedButton(enabled = enabled && !busy, onClick = { picker.launch(arrayOf("*/*")) }) { Text(if (hasCustom) "Другой файл" else "Загрузить .ttf") }
        if (hasCustom) TextButton(enabled = !busy, onClick = {
            app.ryzik.chat.ui.emoji.IosEmoji.removeCustom(context)
            hasCustom = false
            preview = null
            message = "Вернули встроенный набор. Перезапустите приложение."
        }) { Text("Сбросить") }
        TextButton(onClick = { showHelp = true }) { Text("Где взять?") }
    }
    message?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(horizontal = 16.dp, vertical = 6.dp)) }
    if (showHelp) AlertDialog(
        onDismissRequest = { showHelp = false },
        title = { Text("Свой шрифт эмодзи") },
        text = {
            Text(
                "Эмодзи Apple принадлежат Apple, поэтому встроить их в приложение мы не можем. " +
                    "Но вы можете загрузить их сами: найдите файл iOS-эмодзи для Android (обычно называется NotoColorEmoji.ttf " +
                    "или AppleColorEmoji для Android, формат .ttf) и выберите его здесь. " +
                    "Шрифт с iPhone напрямую (формат .ttc/sbix) Android не показывает.",
            )
        },
        confirmButton = { TextButton(onClick = { showHelp = false }) { Text("Понятно") } },
    )
}
