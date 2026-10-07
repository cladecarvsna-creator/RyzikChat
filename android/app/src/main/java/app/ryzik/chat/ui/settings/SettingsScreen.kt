package app.ryzik.chat.ui.settings

import androidx.compose.material.icons.filled.PersonAdd
import app.ryzik.chat.ui.theme.PREMIUM_SEEDS_FROM
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.Code
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Description
import androidx.compose.material.icons.filled.Dns
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Security
import androidx.compose.material.icons.filled.Storage
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LargeTopAppBar
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SegmentedButton
import androidx.compose.material3.SegmentedButtonDefaults
import androidx.compose.material3.SingleChoiceSegmentedButtonRow
import androidx.compose.material3.Slider
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.ryzik.chat.BuildConfig
import app.ryzik.chat.RyzikApp
import app.ryzik.chat.data.AppSettings
import app.ryzik.chat.data.AuthState
import app.ryzik.chat.data.SessionInfo
import app.ryzik.chat.data.ThemeMode
import app.ryzik.chat.data.userMessage
import app.ryzik.chat.ui.chat.QuickReactions
import app.ryzik.chat.ui.components.Avatar
import app.ryzik.chat.ui.components.BadgeChip
import app.ryzik.chat.ui.components.formatListTime
import app.ryzik.chat.ui.components.formatSize
import app.ryzik.chat.ui.theme.SeedColors
import app.ryzik.chat.ui.theme.WallpaperNames
import app.ryzik.chat.ui.theme.wallpaperColors
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

enum class SettingsSection(val title: String, val subtitle: String, val icon: ImageVector) {
    Appearance("Оформление", "Тема, Material You, обои, размер текста", Icons.Default.Palette),
    Chats("Чаты", "Отправка, свайпы, реакции, эмодзи", Icons.AutoMirrored.Filled.Chat),
    Notifications("Уведомления", "Звук, превью, группы", Icons.Default.Notifications),
    Privacy("Конфиденциальность", "Шифрование, сеансы, пароль", Icons.Default.Security),
    Data("Данные и память", "Автозагрузка, кэш", Icons.Default.Storage),
    Server("Сервер", "Адрес вашего сервера RyzikChat", Icons.Default.Dns),
    Api("Открытый API", "Для своих приложений и других устройств", Icons.Default.Code),
    About("О приложении", "Версия, правила", Icons.Default.Info),
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsScreen(
    onBack: () -> Unit,
    onOpenSection: (SettingsSection) -> Unit,
    onOpenAdmin: () -> Unit,
    onOpenSaved: () -> Unit,
    onOpenPremium: () -> Unit,
) {
    val repo = RyzikApp.instance.repo
    val auth by repo.auth.collectAsState()
    val me = (auth as? AuthState.LoggedIn)?.me ?: return
    val accounts by repo.accounts.collectAsState()
    val scope = rememberCoroutineScope()
    var editing by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var bio by remember { mutableStateOf("") }
    var confirmLogout by remember { mutableStateOf(false) }
    var uploading by remember { mutableStateOf(false) }

    val picker = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
        if (uri != null) {
            uploading = true
            scope.launch {
                runCatching { repo.updateProfile(avatarFileId = repo.uploadAvatar(uri)) }
                uploading = false
            }
        }
    }

    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    Scaffold(
        modifier = Modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = {
            LargeTopAppBar(
                title = { Text("Настройки") },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад") } },
                scrollBehavior = scroll,
            )
        },
    ) { padding ->
        LazyColumn(Modifier.fillMaxSize(), contentPadding = padding) {
            item {
                Surface(
                    shape = RoundedCornerShape(28.dp),
                    color = MaterialTheme.colorScheme.surfaceContainerHigh,
                    modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 8.dp),
                ) {
                    Column(Modifier.padding(20.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                        Box {
                            Avatar(me.displayName, repo.avatarUrl(me.avatarFileId), 96.dp)
                            Box(
                                Modifier
                                    .align(Alignment.BottomEnd)
                                    .size(32.dp)
                                    .clip(CircleShape)
                                    .background(MaterialTheme.colorScheme.primary)
                                    .clickable { picker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) },
                                contentAlignment = Alignment.Center,
                            ) {
                                if (uploading) androidx.compose.material3.CircularProgressIndicator(Modifier.size(18.dp), color = MaterialTheme.colorScheme.onPrimary, strokeWidth = 2.dp)
                                else Icon(Icons.Default.CameraAlt, "Сменить фото", Modifier.size(18.dp), tint = MaterialTheme.colorScheme.onPrimary)
                            }
                        }
                        Spacer(Modifier.height(12.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(me.displayName, style = MaterialTheme.typography.headlineSmall)
                            if (me.isPremium) app.ryzik.chat.ui.components.PremiumStar(22.dp)
                            IconButton(onClick = { name = me.displayName; bio = me.bio; editing = true }) {
                                Icon(Icons.Default.Edit, "Изменить", Modifier.size(20.dp))
                            }
                        }
                        Text("@${me.username}", color = MaterialTheme.colorScheme.primary)
                        if (me.bio.isNotBlank()) {
                            Spacer(Modifier.height(6.dp))
                            Text(me.bio, style = MaterialTheme.typography.bodyMedium)
                        }
                        if (me.badges.isNotEmpty() || me.isAdmin) {
                            Spacer(Modifier.height(12.dp))
                            LazyRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                if (me.isAdmin) item { BadgeChip(app.ryzik.chat.data.Badge("admin", "🛡️", "Администратор")) }
                                items(me.badges.size) { BadgeChip(me.badges[it]) }
                            }
                        }
                    }
                }
            }
            item(key = "accounts_header") {
                Text("Аккаунты", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(start = 16.dp, top = 8.dp, bottom = 4.dp))
            }
            items(accounts.size, key = { "acc_" + accounts[it].userId }) { i ->
                val acc = accounts[i]
                val current = acc.userId == me.id
                ListItem(
                    headlineContent = { Text(acc.displayName.ifBlank { acc.username }) },
                    supportingContent = { Text("@${acc.username}" + if (current) " · сейчас" else "") },
                    leadingContent = { Avatar(acc.displayName.ifBlank { acc.username }, repo.avatarUrl(acc.avatarFileId)?.takeIf { current }, 40.dp) },
                    trailingContent = { if (current) Icon(Icons.Default.Check, null, tint = MaterialTheme.colorScheme.primary) },
                    modifier = Modifier.animateItem().clickable(enabled = !current) { repo.switchAccount(acc) },
                )
            }
            if (accounts.size < app.ryzik.chat.data.MAX_ACCOUNTS) item(key = "add_account") {
                ListItem(
                    headlineContent = { Text("Добавить аккаунт", color = MaterialTheme.colorScheme.primary) },
                    supportingContent = { Text("До ${app.ryzik.chat.data.MAX_ACCOUNTS} аккаунтов, переключение в одно касание") },
                    leadingContent = {
                        Box(Modifier.size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primaryContainer), contentAlignment = Alignment.Center) {
                            Icon(Icons.Default.PersonAdd, null, tint = MaterialTheme.colorScheme.onPrimaryContainer)
                        }
                    },
                    modifier = Modifier.clickable { repo.beginAddAccount() },
                )
            }
            item {
                SettingsRow(Icons.Default.Bookmark, "Избранное", "Ваши сохранённые сообщения", onOpenSaved)
            }
            item {
                ListItem(
                    headlineContent = { Text("RyzikChat Премиум") },
                    supportingContent = { Text(if (me.isPremium) "Активен ✨" else "Звезда у имени, файлы до 2 ГБ и не только") },
                    leadingContent = {
                        Box(
                            Modifier.size(40.dp).clip(CircleShape).background(Brush.linearGradient(app.ryzik.chat.ui.components.PremiumGradient)),
                            contentAlignment = Alignment.Center,
                        ) { Icon(Icons.Default.Star, null, tint = Color.White) }
                    },
                    modifier = Modifier.clickable(onClick = onOpenPremium),
                )
            }
            if (me.isAdmin) item {
                SettingsRow(Icons.Default.AdminPanelSettings, "Админ-панель", "Бейджи и права пользователей", onOpenAdmin, accent = true)
            }
            SettingsSection.entries.forEach { s ->
                item(key = s.name) { SettingsRow(s.icon, s.title, s.subtitle, { onOpenSection(s) }) }
            }
            item {
                ListItem(
                    headlineContent = { Text("Выйти", color = MaterialTheme.colorScheme.error) },
                    leadingContent = { Icon(Icons.AutoMirrored.Filled.Logout, null, tint = MaterialTheme.colorScheme.error) },
                    modifier = Modifier.clickable { confirmLogout = true },
                )
                Spacer(Modifier.height(32.dp))
            }
        }
    }

    if (editing) {
        AlertDialog(
            onDismissRequest = { editing = false },
            title = { Text("Профиль") },
            text = {
                Column {
                    OutlinedTextField(name, { name = it.take(64) }, label = { Text("Имя") }, singleLine = true)
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(bio, { bio = it.take(300) }, label = { Text("О себе") }, maxLines = 4)
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    editing = false
                    scope.launch { runCatching { repo.updateProfile(displayName = name.trim(), bio = bio.trim()) } }
                }) { Text("Сохранить") }
            },
            dismissButton = { TextButton(onClick = { editing = false }) { Text("Отмена") } },
        )
    }
    if (confirmLogout) {
        AlertDialog(
            onDismissRequest = { confirmLogout = false },
            title = { Text("Выйти из аккаунта?") },
            text = { Text(if (accounts.size > 1) "Аккаунт уберётся с телефона, откроется другой ваш аккаунт. Чтобы вернуться, понадобится пароль." else "Чтобы снова увидеть переписку, понадобится ваш пароль.") },
            confirmButton = { TextButton(onClick = { confirmLogout = false; repo.logout() }) { Text("Выйти") } },
            dismissButton = { TextButton(onClick = { confirmLogout = false }) { Text("Отмена") } },
        )
    }
}

@Composable
private fun SettingsRow(icon: ImageVector, title: String, subtitle: String, onClick: () -> Unit, accent: Boolean = false) {
    ListItem(
        headlineContent = { Text(title) },
        supportingContent = { Text(subtitle) },
        leadingContent = {
            Box(
                Modifier.size(40.dp).clip(CircleShape)
                    .background(if (accent) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondaryContainer),
                contentAlignment = Alignment.Center,
            ) {
                Icon(icon, null, tint = if (accent) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSecondaryContainer)
            }
        },
        modifier = Modifier.clickable(onClick = onClick),
    )
}

// ===================== Разделы =====================

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SettingsSectionScreen(section: SettingsSection, onBack: () -> Unit, onOpenTerms: () -> Unit, onOpenPremium: () -> Unit = {}) {
    val app = RyzikApp.instance
    val settings by app.prefs.settings.collectAsState(initial = AppSettings())
    val scope = rememberCoroutineScope()
    fun update(block: (AppSettings) -> AppSettings) {
        scope.launch { app.prefs.update(block) }
    }
    val scroll = TopAppBarDefaults.exitUntilCollapsedScrollBehavior()
    Scaffold(
        modifier = Modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = {
            LargeTopAppBar(
                title = { Text(section.title) },
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад") } },
                scrollBehavior = scroll,
            )
        },
    ) { padding ->
        Column(Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState())) {
            when (section) {
                SettingsSection.Appearance -> AppearanceSettings(settings, ::update, onOpenPremium)
                SettingsSection.Chats -> ChatSettings(settings, ::update)
                SettingsSection.Notifications -> NotificationSettings(settings, ::update)
                SettingsSection.Privacy -> PrivacySettings(settings, ::update)
                SettingsSection.Data -> DataSettings(settings, ::update)
                SettingsSection.Server -> ServerSettings()
                SettingsSection.Api -> ApiSettings()
                SettingsSection.About -> AboutSettings(onOpenTerms)
            }
            Spacer(Modifier.height(32.dp))
        }
    }
}

@Composable
private fun Header(text: String) {
    Text(text, style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 4.dp))
}

@Composable
private fun SwitchRow(title: String, subtitle: String? = null, checked: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    ListItem(
        headlineContent = { Text(title) },
        supportingContent = if (subtitle != null) { { Text(subtitle) } } else null,
        trailingContent = { Switch(checked = checked, onCheckedChange = onChange, enabled = enabled) },
        modifier = Modifier.clickable(enabled = enabled) { onChange(!checked) },
    )
}

@Composable
private fun AppearanceSettings(s: AppSettings, update: ((AppSettings) -> AppSettings) -> Unit, onOpenPremium: () -> Unit) {
    val auth by RyzikApp.instance.repo.auth.collectAsState()
    val premium = (auth as? AuthState.LoggedIn)?.me?.isPremium == true
    Header("Тема")
    SingleChoiceSegmentedButtonRow(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
        ThemeMode.entries.forEachIndexed { i, m ->
            SegmentedButton(
                selected = s.themeMode == m,
                onClick = { update { it.copy(themeMode = m) } },
                shape = SegmentedButtonDefaults.itemShape(i, ThemeMode.entries.size),
            ) { Text(m.title) }
        }
    }
    val dynamicAvailable = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
    SwitchRow(
        "Material You",
        if (dynamicAvailable) "Цвета подстраиваются под обои телефона" else "Нужен Android 12 или новее",
        s.dynamicColor && dynamicAvailable,
        enabled = dynamicAvailable,
    ) { v -> update { it.copy(dynamicColor = v) } }
    AnimatedVisibility(!s.dynamicColor || !dynamicAvailable) {
        Column {
            Header("Цвет приложения")
            LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                itemsIndexed(SeedColors) { i, (color, name) ->
                    val selected = s.seedColor == i
                    val size by animateDpAsState(if (selected) 56.dp else 48.dp, spring(Spring.DampingRatioMediumBouncy), label = "seed")
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(
                            Modifier.size(56.dp),
                            contentAlignment = Alignment.Center,
                        ) {
                            Box(
                                Modifier
                                    .size(size)
                                    .clip(CircleShape)
                                    .background(Brush.linearGradient(listOf(color, color.copy(alpha = 0.6f))))
                                    .clickable {
                                        if (i >= PREMIUM_SEEDS_FROM && !premium) onOpenPremium() else update { it.copy(seedColor = i) }
                                    },
                                contentAlignment = Alignment.Center,
                            ) {
                                if (selected) Icon(Icons.Default.Check, null, tint = Color.White)
                                else if (i >= PREMIUM_SEEDS_FROM) Icon(if (premium) Icons.Default.Star else Icons.Default.Lock, null, tint = Color.White, modifier = Modifier.size(18.dp))
                            }
                        }
                        Text(name, style = MaterialTheme.typography.labelSmall)
                    }
                }
            }
        }
    }
    SwitchRow("Чёрная тема (AMOLED)", "Глубокий чёрный в тёмной теме", s.amoled) { v -> update { it.copy(amoled = v) } }

    Header("Обои чата")
    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        itemsIndexed(WallpaperNames) { i, name ->
            val selected = s.wallpaper == i
            val border by animateColorAsState(if (selected) MaterialTheme.colorScheme.primary else Color.Transparent, label = "wb")
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Box(
                    Modifier
                        .size(width = 72.dp, height = 110.dp)
                        .clip(RoundedCornerShape(16.dp))
                        .border(3.dp, border, RoundedCornerShape(16.dp))
                        .background(Brush.verticalGradient(wallpaperColors(i).let { if (it.size < 2) it + it else it }))
                        .background(MaterialTheme.colorScheme.outlineVariant.copy(alpha = if (i == 0) 0.2f else 0f))
                        .clickable { update { it.copy(wallpaper = i) } },
                )
                Text(name, style = MaterialTheme.typography.labelSmall)
            }
        }
    }

    Header("Размер текста: ${s.textSize.toInt()}")
    Slider(
        value = s.textSize, onValueChange = { v -> update { it.copy(textSize = v) } },
        valueRange = 12f..24f, steps = 11,
        modifier = Modifier.padding(horizontal = 16.dp),
    )
    Header("Скругление сообщений: ${s.bubbleRadius.toInt()}")
    Slider(
        value = s.bubbleRadius, onValueChange = { v -> update { it.copy(bubbleRadius = v) } },
        valueRange = 4f..28f,
        modifier = Modifier.padding(horizontal = 16.dp),
    )
    // Предпросмотр
    Box(
        Modifier
            .fillMaxWidth()
            .padding(16.dp)
            .clip(RoundedCornerShape(24.dp))
            .background(Brush.verticalGradient(wallpaperColors(s.wallpaper)))
            .border(1.dp, MaterialTheme.colorScheme.outlineVariant, RoundedCornerShape(24.dp))
            .padding(12.dp),
    ) {
        Column(Modifier.fillMaxWidth()) {
            Surface(shape = RoundedCornerShape(s.bubbleRadius.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh) {
                Text("Привет! Как тебе новая тема? 🎨", Modifier.padding(horizontal = 12.dp, vertical = 8.dp), fontSize = s.textSize.sp)
            }
            Spacer(Modifier.height(6.dp))
            Surface(shape = RoundedCornerShape(s.bubbleRadius.dp), color = MaterialTheme.colorScheme.primaryContainer, modifier = Modifier.align(Alignment.End)) {
                Text("Огонь! 🔥", Modifier.padding(horizontal = 12.dp, vertical = 8.dp), fontSize = s.textSize.sp, color = MaterialTheme.colorScheme.onPrimaryContainer)
            }
        }
    }
    SwitchRow("Компактный список чатов", null, s.compactList) { v -> update { it.copy(compactList = v) } }
    SwitchRow("Анимации", "Пружинки, появление сообщений и прочая красота", s.animations) { v -> update { it.copy(animations = v) } }
}

@Composable
private fun ChatSettings(s: AppSettings, update: ((AppSettings) -> AppSettings) -> Unit) {
    Header("Отправка")
    SwitchRow("Отправка по Enter", "Новая строка — через Shift+Enter на физической клавиатуре", s.sendByEnter) { v -> update { it.copy(sendByEnter = v) } }
    SwitchRow("Свайп для ответа", "Потяните сообщение влево, чтобы ответить", s.swipeToReply) { v -> update { it.copy(swipeToReply = v) } }
    SwitchRow("Крупные эмодзи", "Сообщения из 1–3 эмодзи показываются большими", s.bigEmoji) { v -> update { it.copy(bigEmoji = v) } }
    Header("Быстрая реакция (двойное касание)")
    LazyRow(contentPadding = PaddingValues(horizontal = 16.dp), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
        itemsIndexed(QuickReactions) { _, e ->
            val selected = s.quickReaction == e
            Box(
                Modifier
                    .size(48.dp)
                    .clip(CircleShape)
                    .background(if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh)
                    .clickable { update { it.copy(quickReaction = e) } },
                contentAlignment = Alignment.Center,
            ) { Text(e, fontSize = 24.sp) }
        }
    }
}

@Composable
private fun NotificationSettings(s: AppSettings, update: ((AppSettings) -> AppSettings) -> Unit) {
    SwitchRow("Уведомления", "Показывать новые сообщения", s.notifications) { v -> update { it.copy(notifications = v) } }
    SwitchRow("Текст в уведомлении", "Показывать содержание сообщения", s.notificationPreview, enabled = s.notifications) { v -> update { it.copy(notificationPreview = v) } }
    SwitchRow("Группы", "Уведомления из групповых чатов", s.groupNotifications, enabled = s.notifications) { v -> update { it.copy(groupNotifications = v) } }
    SwitchRow("Вибрация", null, s.vibrate, enabled = s.notifications) { v -> update { it.copy(vibrate = v) } }
    Text(
        "Уведомления приходят, пока приложение работает в фоне. Отключить звук для отдельного чата можно в его меню.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(16.dp),
    )
}

@Composable
private fun PrivacySettings(s: AppSettings, update: ((AppSettings) -> AppSettings) -> Unit) {
    val repo = RyzikApp.instance.repo
    val scope = rememberCoroutineScope()
    var sessions by remember { mutableStateOf<List<SessionInfo>>(emptyList()) }
    var changing by remember { mutableStateOf(false) }
    var info by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { sessions = runCatching { repo.api.sessions() }.getOrDefault(emptyList()) }

    Header("Сквозное шифрование")
    Surface(
        shape = RoundedCornerShape(20.dp),
        color = MaterialTheme.colorScheme.secondaryContainer,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp),
    ) {
        Column(Modifier.padding(16.dp)) {
            Text("🔒 Все сообщения, фото, видео и файлы шифруются на вашем телефоне. Сервер хранит только шифротекст.")
            Spacer(Modifier.height(12.dp))
            Text("Ваш отпечаток ключа:", style = MaterialTheme.typography.labelLarge)
            Text(repo.myFingerprint(), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
        }
    }
    Header("Приватность")
    SwitchRow("Отчёты о прочтении", "Показывать галочки «прочитано»", s.showReadReceipts) { v -> update { it.copy(showReadReceipts = v) } }
    SwitchRow("Статус «печатает…»", "Показывать, когда собеседник набирает текст", s.showTyping) { v -> update { it.copy(showTyping = v) } }

    Header("Активные сеансы")
    sessions.forEach { ses ->
        ListItem(
            headlineContent = { Text(ses.device.ifBlank { "Устройство" } + if (ses.current) " · это устройство" else "") },
            supportingContent = { Text("Вход: ${formatListTime(ses.createdAt)}") },
        )
    }
    if (sessions.size > 1) {
        TextButton(onClick = {
            scope.launch {
                runCatching { repo.api.terminateOtherSessions() }
                sessions = runCatching { repo.api.sessions() }.getOrDefault(sessions)
            }
        }, modifier = Modifier.padding(horizontal = 8.dp)) { Text("Завершить другие сеансы", color = MaterialTheme.colorScheme.error) }
    }
    Header("Пароль")
    ListItem(
        headlineContent = { Text("Сменить пароль") },
        supportingContent = { Text("Ключи шифрования перешифруются новым паролем") },
        modifier = Modifier.clickable { changing = true },
    )
    info?.let { Text(it, Modifier.padding(16.dp), color = MaterialTheme.colorScheme.primary) }

    if (changing) {
        var old by remember { mutableStateOf("") }
        var new by remember { mutableStateOf("") }
        var err by remember { mutableStateOf<String?>(null) }
        AlertDialog(
            onDismissRequest = { changing = false },
            title = { Text("Новый пароль") },
            text = {
                Column {
                    OutlinedTextField(old, { old = it }, label = { Text("Текущий пароль") }, singleLine = true,
                        visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation())
                    Spacer(Modifier.height(8.dp))
                    OutlinedTextField(new, { new = it }, label = { Text("Новый пароль (от 8 символов)") }, singleLine = true,
                        visualTransformation = androidx.compose.ui.text.input.PasswordVisualTransformation())
                    err?.let { Text(it, color = MaterialTheme.colorScheme.error) }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    if (new.length < 8) { err = "Минимум 8 символов"; return@TextButton }
                    scope.launch {
                        runCatching { repo.changePassword(old, new) }
                            .onSuccess { changing = false; info = "Пароль изменён. Другие сеансы завершены." }
                            .onFailure { err = it.userMessage() }
                    }
                }) { Text("Сменить") }
            },
            dismissButton = { TextButton(onClick = { changing = false }) { Text("Отмена") } },
        )
    }
}

@Composable
private fun DataSettings(s: AppSettings, update: ((AppSettings) -> AppSettings) -> Unit) {
    val repo = RyzikApp.instance.repo
    var size by remember { mutableStateOf(repo.cacheSize()) }
    SwitchRow("Автозагрузка медиа", "Скачивать фото, небольшие видео и файлы сразу", s.autoDownload) { v -> update { it.copy(autoDownload = v) } }
    Header("Память")
    ListItem(
        headlineContent = { Text("Очистить кэш") },
        supportingContent = { Text("Сейчас занято: ${formatSize(size)}. Файлы можно будет скачать снова.") },
        leadingContent = { Icon(Icons.Default.Storage, null) },
        modifier = Modifier.clickable { repo.clearCache(); size = repo.cacheSize() },
    )
}

@Composable
private fun ServerSettings() {
    val repo = RyzikApp.instance.repo
    val scope = rememberCoroutineScope()
    var url by remember { mutableStateOf("") }
    var status by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(Unit) { url = repo.prefs.session.first().serverUrl }
    Column(Modifier.padding(16.dp)) {
        Text(
            "RyzikChat работает через собственный API. Если вы перенесли сервер, укажите новый адрес. Аккаунт и ключи останутся теми же только на том же сервере.",
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(12.dp))
        OutlinedTextField(url, { url = it.trim() }, label = { Text("Адрес сервера") }, singleLine = true, modifier = Modifier.fillMaxWidth())
        Spacer(Modifier.height(8.dp))
        Row {
            TextButton(onClick = {
                scope.launch {
                    val old = repo.api.baseUrl
                    repo.api.baseUrl = url.trimEnd('/')
                    status = if (repo.checkServer()) "✅ Сервер отвечает" else "❌ Сервер не отвечает"
                    repo.api.baseUrl = old
                }
            }) { Text("Проверить") }
            TextButton(onClick = { scope.launch { repo.setServer(url); status = "Сохранено" } }) { Text("Сохранить") }
        }
        status?.let { Text(it) }
    }
}

@Composable
private fun ApiSettings() {
    val repo = RyzikApp.instance.repo
    val context = androidx.compose.ui.platform.LocalContext.current
    val base = repo.api.baseUrl
    var showToken by remember { mutableStateOf(false) }
    fun open(url: String) {
        runCatching { context.startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url)).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK)) }
    }
    Column(Modifier.padding(16.dp)) {
        Text(
            "У RyzikChat открытый API: на нём можно сделать свой клиент для ПК, веба, часов или бота. " +
                "Всё описано в спецификации OpenAPI 3, там же формат шифрования и события WebSocket.",
            style = MaterialTheme.typography.bodyMedium,
        )
    }
    Header("Документация")
    ListItem(
        headlineContent = { Text("Документация API") },
        supportingContent = { Text("$base/api/docs") },
        leadingContent = { Icon(Icons.Default.Description, null) },
        modifier = Modifier.clickable { open("$base/api/docs") },
    )
    ListItem(
        headlineContent = { Text("Спецификация OpenAPI (JSON)") },
        supportingContent = { Text("$base/api/openapi.json") },
        leadingContent = { Icon(Icons.Default.Code, null) },
        modifier = Modifier.clickable { open("$base/api/openapi.json") },
    )
    Header("Как подключиться")
    Column(Modifier.padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        listOf(
            "1. POST /api/auth/login → token",
            "2. Заголовок Authorization: Bearer <token>",
            "3. WebSocket $base/ws?token=<token> — новые сообщения, «печатает», звонки",
            "4. Личные чаты и группы шифруются на устройстве (X25519 + AES-GCM), каналы — открытым текстом",
        ).forEach { Text(it, style = MaterialTheme.typography.bodyMedium, fontFamily = androidx.compose.ui.text.font.FontFamily.Monospace) }
    }
    Header("Токен этого устройства")
    ListItem(
        headlineContent = { Text(if (showToken) (repo.api.token ?: "—") else "Показать токен") },
        supportingContent = { Text("Никому не передавайте: с ним можно читать ваши чаты от вашего имени") },
        leadingContent = { Icon(Icons.Default.Lock, null) },
        modifier = Modifier.clickable { showToken = !showToken },
    )
}

@Composable
private fun AboutSettings(onOpenTerms: () -> Unit) {
    Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text("🦊", fontSize = 64.sp)
        Text("RyzikChat", style = MaterialTheme.typography.headlineMedium)
        Text("Версия ${BuildConfig.VERSION_NAME}", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.height(12.dp))
        Text("Мессенджер со сквозным шифрованием, своим сервером и дизайном Material You.", style = MaterialTheme.typography.bodyMedium)
    }
    ListItem(
        headlineContent = { Text("Правила использования") },
        leadingContent = { Icon(Icons.Default.Description, null) },
        modifier = Modifier.clickable(onClick = onOpenTerms),
    )
}
