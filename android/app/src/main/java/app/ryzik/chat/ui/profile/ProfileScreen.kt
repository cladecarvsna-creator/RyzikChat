package app.ryzik.chat.ui.profile

import androidx.compose.material.icons.filled.Public
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.CameraAlt
import androidx.compose.material.icons.filled.Palette
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Star
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.AdminPanelSettings
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.PersonRemove
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ElevatedCard
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
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
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import app.ryzik.chat.RyzikApp
import app.ryzik.chat.data.AuthState
import app.ryzik.chat.data.Badge
import app.ryzik.chat.data.userMessage
import app.ryzik.chat.ui.components.Avatar
import app.ryzik.chat.ui.components.BadgeChip
import app.ryzik.chat.ui.components.NameWithBadges
import app.ryzik.chat.ui.components.formatLastSeen
import kotlinx.coroutines.launch

/**
 * Профиль пользователя. Администратор видит здесь управление бейджами.
 * Свой профиль (вкладка «Профиль») можно менять: фото, имя, «о себе», оформление.
 */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
fun ProfileScreen(
    userId: String,
    onBack: (() -> Unit)?,
    onOpenChat: (String) -> Unit,
    onOpenProfileLook: () -> Unit = {},
    onOpenSaved: () -> Unit = {},
) {
    val repo = RyzikApp.instance.repo
    val users by repo.users.collectAsState()
    val contacts by repo.contacts.collectAsState()
    val auth by repo.auth.collectAsState()
    val me = (auth as? AuthState.LoggedIn)?.me
    val isMe = userId == me?.id
    val user = if (isMe) me else users[userId]
    val scope = rememberCoroutineScope()
    var allBadges by remember { mutableStateOf<List<Badge>>(emptyList()) }
    var error by remember { mutableStateOf<String?>(null) }
    var blocked by remember(userId) { mutableStateOf(false) }
    var editing by remember { mutableStateOf(false) }
    var name by remember { mutableStateOf("") }
    var bio by remember { mutableStateOf("") }
    var uploading by remember { mutableStateOf(false) }
    val isContact = contacts.any { it.id == userId }

    LaunchedEffect(userId) {
        runCatching { repo.loadUser(userId) }.onSuccess { blocked = it.isBlocked }.onFailure { error = it.userMessage() }
        if (me?.isAdmin == true) allBadges = runCatching { repo.badges() }.getOrDefault(emptyList())
    }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text(if (isMe) "Мой профиль" else "Профиль") },
            navigationIcon = { if (onBack != null) IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад") } },
            actions = {
                if (isMe) IconButton(onClick = { name = me?.displayName.orEmpty(); bio = me?.bio.orEmpty(); editing = true }) {
                    Icon(Icons.Default.Edit, "Изменить")
                }
            },
        )
    }) { padding ->
        Column(
            Modifier.fillMaxSize().padding(padding).verticalScroll(rememberScrollState()),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            if (user == null) {
                Text(error ?: "Загрузка…", Modifier.padding(32.dp))
                return@Column
            }
            val pop = remember { Animatable(0.6f) }
            LaunchedEffect(Unit) { pop.animateTo(1f, spring(Spring.DampingRatioMediumBouncy, Spring.StiffnessLow)) }
            app.ryzik.chat.ui.premium.ProfileHeader(
                name = user.displayName,
                avatarUrl = repo.avatarUrl(user.avatarFileId),
                online = user.online && !isMe,
                isPremium = user.isPremium,
                isAdmin = user.isAdmin,
                emojiStatus = user.emojiStatus,
                style = user.profileStyle,
                bannerUrl = repo.avatarUrl(user.profileStyle?.bannerFileId),
                avatarScale = pop.value,
            )
            Text("@${user.username}", color = MaterialTheme.colorScheme.primary)
            if (!isMe && !user.isService) Text(
                formatLastSeen(user.online, user.lastSeen),
                style = MaterialTheme.typography.labelLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (user.bio.isNotBlank()) {
                Spacer(Modifier.height(12.dp))
                Text(user.bio, textAlign = TextAlign.Center, modifier = Modifier.padding(horizontal = 32.dp))
            }

            if (isMe) {
                val picker = androidx.activity.compose.rememberLauncherForActivityResult(
                    androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia(),
                ) { uri ->
                    if (uri != null) {
                        uploading = true
                        scope.launch {
                            runCatching { repo.updateProfile(avatarFileId = repo.uploadAvatar(uri)) }.onFailure { error = it.userMessage() }
                            uploading = false
                        }
                    }
                }
                Spacer(Modifier.height(16.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(horizontal = 16.dp)) {
                    ProfileAction(Icons.Default.CameraAlt, if (uploading) "Загрузка…" else "Фото", Modifier.weight(1f)) {
                        picker.launch(
                            androidx.activity.result.PickVisualMediaRequest(
                                androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia.ImageOnly,
                            ),
                        )
                    }
                    ProfileAction(Icons.Default.Edit, "Изменить", Modifier.weight(1f)) {
                        name = user.displayName; bio = user.bio; editing = true
                    }
                    ProfileAction(Icons.Default.Palette, "Оформление", Modifier.weight(1f), onOpenProfileLook)
                }
                Spacer(Modifier.height(12.dp))
                ElevatedCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                    ListItem(
                        headlineContent = { Text("Избранное") },
                        supportingContent = { Text("Ваши сохранённые сообщения") },
                        leadingContent = { Icon(Icons.Default.Bookmark, null, tint = MaterialTheme.colorScheme.primary) },
                        modifier = Modifier.clickable(onClick = onOpenSaved),
                    )
                }
            } else if (!user.isService) {
                Spacer(Modifier.height(20.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(horizontal = 16.dp)) {
                    if (!blocked) ProfileAction(Icons.AutoMirrored.Filled.Chat, "Написать", Modifier.weight(1f)) {
                        scope.launch { runCatching { repo.openDirect(user.id) }.onSuccess { onOpenChat(it.id) }.onFailure { error = it.userMessage() } }
                    }
                    if (!blocked) ProfileAction(
                        if (isContact) Icons.Default.PersonRemove else Icons.Default.PersonAdd,
                        if (isContact) "Убрать из контактов" else "В контакты",
                        Modifier.weight(1f),
                    ) {
                        scope.launch { runCatching { repo.setContact(user.id, !isContact) }.onFailure { error = it.userMessage() } }
                    }
                    ProfileAction(
                        Icons.Default.Block,
                        if (blocked) "Разблокировать" else "Заблокировать",
                        Modifier.weight(1f),
                        danger = !blocked,
                    ) {
                        scope.launch {
                            runCatching { repo.setBlocked(user.id, !blocked) }
                                .onSuccess { blocked = !blocked }
                                .onFailure { error = it.userMessage() }
                        }
                    }
                }
            }

            if (user.badges.isNotEmpty() || user.isAdmin) {
                Spacer(Modifier.height(16.dp))
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.padding(horizontal = 16.dp),
                ) {
                    if (user.isAdmin) BadgeChip(Badge("admin", "🛡️", "Администратор", color = "#6750A4"))
                    user.badges.forEach { BadgeChip(it) }
                }
            }

            Spacer(Modifier.height(20.dp))
            ElevatedCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                ListItem(
                    headlineContent = { Text("Ключ шифрования") },
                    supportingContent = {
                        Text(repo.fingerprintOf(user), fontFamily = FontFamily.Monospace, style = MaterialTheme.typography.bodySmall)
                    },
                    leadingContent = { Icon(Icons.Default.Lock, null) },
                )
                Text(
                    "Сверьте эти цифры с собеседником при встрече: если совпадают, никто не подменил ключи.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(start = 16.dp, end = 16.dp, bottom = 16.dp),
                )
            }

            if (me?.isAdmin == true) {
                Spacer(Modifier.height(16.dp))
                ElevatedCard(Modifier.fillMaxWidth().padding(horizontal = 16.dp)) {
                    Column(Modifier.padding(16.dp)) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.AdminPanelSettings, null, tint = MaterialTheme.colorScheme.primary)
                            Spacer(Modifier.width(8.dp))
                            Text("Администрирование", style = MaterialTheme.typography.titleMedium)
                        }
                        Spacer(Modifier.height(12.dp))
                        Text("Бейджи пользователя", style = MaterialTheme.typography.labelLarge)
                        Spacer(Modifier.height(8.dp))
                        if (allBadges.isEmpty()) {
                            Text(
                                "Бейджей пока нет. Создайте их в «Настройки → Админ-панель».",
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            allBadges.forEach { b ->
                                val has = user.badges.any { it.id == b.id }
                                FilterChip(
                                    selected = has,
                                    onClick = {
                                        scope.launch {
                                            runCatching {
                                                if (has) repo.revokeBadge(user.id, b.id) else repo.grantBadge(user.id, b.id)
                                            }.onFailure { error = it.userMessage() }
                                        }
                                    },
                                    label = { Text("${b.emoji} ${b.title}") },
                                )
                            }
                        }
                        Spacer(Modifier.height(8.dp))
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Default.Star, null)
                            Spacer(Modifier.width(8.dp))
                            Text("Премиум", Modifier.weight(1f))
                            Switch(checked = user.isPremium, onCheckedChange = { v ->
                                scope.launch { runCatching { repo.setPremium(user.id, v) }.onFailure { error = it.userMessage() } }
                            })
                        }
                        if (user.id != me?.id) {
                            Spacer(Modifier.height(8.dp))
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Icon(Icons.Default.Verified, null)
                                Spacer(Modifier.width(8.dp))
                                Text("Администратор", Modifier.weight(1f))
                                Switch(checked = user.isAdmin, onCheckedChange = { v ->
                                    scope.launch { runCatching { repo.setAdmin(user.id, v) }.onFailure { error = it.userMessage() } }
                                })
                            }
                        }
                    }
                }
            }
            AnimatedVisibility(error != null) {
                Text(error.orEmpty(), color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(16.dp))
            }
            Spacer(Modifier.height(32.dp))
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
                TextButton(enabled = name.isNotBlank(), onClick = {
                    editing = false
                    scope.launch { runCatching { repo.updateProfile(displayName = name.trim(), bio = bio.trim()) }.onFailure { error = it.userMessage() } }
                }) { Text("Сохранить") }
            },
            dismissButton = { TextButton(onClick = { editing = false }) { Text("Отмена") } },
        )
    }
}

/** Кнопка-плитка под шапкой профиля. */
@Composable
private fun ProfileAction(
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    label: String,
    modifier: Modifier = Modifier,
    danger: Boolean = false,
    onClick: () -> Unit,
) {
    val color = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.primary
    androidx.compose.material3.Surface(
        onClick = onClick,
        shape = androidx.compose.foundation.shape.RoundedCornerShape(18.dp),
        color = MaterialTheme.colorScheme.surfaceContainerHigh,
        modifier = modifier,
    ) {
        Column(Modifier.padding(vertical = 12.dp, horizontal = 6.dp), horizontalAlignment = Alignment.CenterHorizontally) {
            Icon(icon, null, tint = color)
            Spacer(Modifier.height(4.dp))
            Text(label, style = MaterialTheme.typography.labelMedium, color = color, textAlign = TextAlign.Center, maxLines = 2)
        }
    }
}

/** Информация о чате: для личного — профиль собеседника, для группы — участники. */
@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ChatInfoScreen(
    chatId: String,
    onBack: () -> Unit,
    onOpenProfile: (String) -> Unit,
    onOpenChat: (String) -> Unit,
    onAddMembers: () -> Unit,
    onLeft: () -> Unit,
) {
    val repo = RyzikApp.instance.repo
    val chats by repo.chats.collectAsState()
    val users by repo.users.collectAsState()
    val chat = chats.firstOrNull { it.id == chatId }
    val scope = rememberCoroutineScope()
    var renaming by remember { mutableStateOf(false) }
    var newTitle by remember { mutableStateOf("") }
    var newDescription by remember { mutableStateOf("") }
    var avatarBusy by remember { mutableStateOf(false) }
    var infoError by remember { mutableStateOf<String?>(null) }
    val context = androidx.compose.ui.platform.LocalContext.current
    val clipboard = androidx.compose.ui.platform.LocalClipboardManager.current
    val myId = repo.myId

    if (chat?.type == "direct") {
        val peer = repo.peerOf(chat)
        if (peer != null) {
            ProfileScreen(peer.id, onBack, onOpenChat)
            return
        }
    }

    Scaffold(topBar = {
        TopAppBar(
            title = { Text(when (chat?.type) { "saved" -> "Избранное"; "channel" -> "Канал"; else -> "Группа" }) },
            navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад") } },
            actions = {
                val owner = chat?.members?.any { it.user.id == myId && it.role == "owner" } == true
                if ((chat?.type == "group" && owner) || (chat?.type == "channel" && (chat.myRole == "owner" || chat.myRole == "admin"))) {
                    IconButton(onClick = { newTitle = chat.title; newDescription = chat.description; renaming = true }) { Icon(Icons.Default.Edit, "Изменить") }
                }
            },
        )
    }) { padding ->
        if (chat == null) return@Scaffold
        val owner = chat.members.any { it.user.id == myId && it.role == "owner" } || chat.myRole == "owner"
        val canEdit = (chat.type == "group" && owner) || (chat.type == "channel" && (chat.myRole == "owner" || chat.myRole == "admin"))
        val isGroupOrChannel = chat.type == "group" || chat.type == "channel"
        androidx.compose.foundation.lazy.LazyColumn(Modifier.fillMaxSize().padding(padding)) {
            item {
                Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    if (canEdit) {
                        app.ryzik.chat.ui.channel.AvatarPicker(repo.chatTitle(chat), repo.avatarUrl(chat.avatarFileId), 110.dp, busy = avatarBusy) { uri ->
                            avatarBusy = true
                            scope.launch {
                                runCatching { repo.setChatAvatar(chat.id, repo.uploadAvatar(uri)) }
                                    .onFailure { infoError = it.userMessage() }
                                avatarBusy = false
                            }
                        }
                    } else Avatar(repo.chatTitle(chat), repo.avatarUrl(chat.avatarFileId), 110.dp, saved = chat.type == "saved", service = chat.isService)
                    Spacer(Modifier.height(12.dp))
                    Text(repo.chatTitle(chat), style = MaterialTheme.typography.headlineSmall)
                    if (chat.isService) {
                        Text("официальный чат RyzikChat", color = MaterialTheme.colorScheme.primary)
                        Spacer(Modifier.height(12.dp))
                        Text(
                            "Сюда приходят коды для входа в ваш аккаунт с других устройств и важные новости. Никому не сообщайте эти коды.",
                            textAlign = TextAlign.Center,
                            modifier = Modifier.padding(horizontal = 24.dp),
                        )
                    } else if (isGroupOrChannel) {
                        val count = if (chat.type == "group") app.ryzik.chat.ui.channel.membersText(maxOf(chat.memberCount, chat.members.size))
                        else app.ryzik.chat.ui.chats.subscribersText(chat.memberCount)
                        val kind = when {
                            chat.type == "group" && chat.isPublic -> "публичная группа"
                            chat.type == "group" -> "частная группа"
                            chat.isPublic -> "публичный канал"
                            else -> "частный канал"
                        }
                        Text("$kind · $count", color = MaterialTheme.colorScheme.onSurfaceVariant)
                        if (chat.description.isNotBlank()) {
                            Spacer(Modifier.height(12.dp))
                            Text(chat.description, textAlign = TextAlign.Center)
                        }
                    }
                    infoError?.let { Spacer(Modifier.height(8.dp)); Text(it, color = MaterialTheme.colorScheme.error) }
                    if (chat.type == "saved") Text(
                        "Здесь хранятся ваши заметки и сохранённые сообщения. Они тоже зашифрованы.",
                        textAlign = TextAlign.Center,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
            if (isGroupOrChannel && chat.myRole != null) {
                val code = chat.inviteCode
                if (code != null) item {
                    val link = app.ryzik.chat.ui.channel.inviteLink(code)
                    ListItem(
                        headlineContent = { Text(link, maxLines = 1, overflow = androidx.compose.ui.text.style.TextOverflow.Ellipsis) },
                        supportingContent = { Text("Ссылка-приглашение · нажмите, чтобы скопировать") },
                        leadingContent = { Icon(Icons.Default.Link, null, tint = MaterialTheme.colorScheme.primary) },
                        trailingContent = {
                            IconButton(onClick = {
                                val send = android.content.Intent(android.content.Intent.ACTION_SEND).setType("text/plain")
                                    .putExtra(android.content.Intent.EXTRA_TEXT, "Присоединяйся к «${chat.title}» в RyzikChat: $link")
                                context.startActivity(android.content.Intent.createChooser(send, "Поделиться ссылкой"))
                            }) { Icon(Icons.Default.Share, "Поделиться") }
                        },
                        modifier = Modifier.clickable {
                            clipboard.setText(androidx.compose.ui.text.AnnotatedString(link))
                            android.widget.Toast.makeText(context, "Ссылка скопирована", android.widget.Toast.LENGTH_SHORT).show()
                        },
                    )
                }
                if (canEdit && code != null) item {
                    ListItem(
                        headlineContent = { Text("Сменить ссылку") },
                        supportingContent = { Text("Старая ссылка перестанет работать") },
                        leadingContent = { Icon(Icons.Default.Refresh, null) },
                        modifier = Modifier.clickable { scope.launch { runCatching { repo.resetInvite(chat.id) }.onFailure { infoError = it.userMessage() } } },
                    )
                }
                if (chat.myRole == "owner") item {
                    ListItem(
                        headlineContent = { Text(if (chat.type == "channel") "Публичный канал" else "Публичная группа") },
                        supportingContent = {
                            Text(
                                if (chat.isPublic) "Виден в поиске, ${if (chat.type == "channel") "подписаться" else "вступить"} может любой"
                                else "Скрыт из поиска, только по ссылке-приглашению"
                            )
                        },
                        leadingContent = { Icon(if (chat.isPublic) Icons.Default.Public else Icons.Default.Lock, null) },
                        trailingContent = {
                            androidx.compose.material3.Switch(chat.isPublic, onCheckedChange = { v ->
                                scope.launch { runCatching { repo.setChatPublic(chat.id, v) }.onFailure { infoError = it.userMessage() } }
                            })
                        },
                    )
                }
            }
            if (chat.type == "group" && chat.myRole == null && chat.isPublic) item {
                ListItem(
                    headlineContent = { Text("Вступить в группу", color = MaterialTheme.colorScheme.primary) },
                    leadingContent = { Icon(Icons.Default.PersonAdd, null, tint = MaterialTheme.colorScheme.primary) },
                    modifier = Modifier.clickable { scope.launch { runCatching { repo.subscribe(chat.id) }.onFailure { infoError = it.userMessage() } } },
                )
            }
            if (chat.type == "channel" && !chat.isService) {
                if (chat.myRole != null) item {
                    ListItem(
                        headlineContent = { Text(if (chat.muted) "Включить звук" else "Выключить звук") },
                        leadingContent = { Icon(if (chat.muted) Icons.Default.Notifications else Icons.Default.NotificationsOff, null) },
                        modifier = Modifier.clickable { scope.launch { runCatching { repo.setMuted(chat.id, !chat.muted) } } },
                    )
                }
                item {
                    Text("Администраторы", style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(start = 16.dp, top = 8.dp))
                }
                items(chat.members.size, key = { chat.members[it].user.id }) { i ->
                    val m = chat.members[i]
                    val u = users[m.user.id] ?: m.user
                    ListItem(
                        headlineContent = { NameWithBadges(u.displayName, u.badges, u.isAdmin, MaterialTheme.typography.bodyLarge, isPremium = u.isPremium, emojiStatus = u.emojiStatus) },
                        supportingContent = { Text(if (m.role == "owner") "владелец" else "админ") },
                        leadingContent = { Avatar(u.displayName, repo.avatarUrl(u.avatarFileId), 44.dp, online = u.online) },
                        trailingContent = {
                            if (chat.myRole == "owner" && m.role == "admin") IconButton(onClick = {
                                scope.launch { runCatching { repo.setChannelAdmin(chat.id, u.id, false) } }
                            }) { Icon(Icons.Default.PersonRemove, "Снять админа") }
                        },
                        modifier = Modifier.clickable { onOpenProfile(u.id) },
                    )
                }
                item {
                    if (chat.myRole == null) {
                        ListItem(
                            headlineContent = { Text("Подписаться", color = MaterialTheme.colorScheme.primary) },
                            leadingContent = { Icon(Icons.Default.PersonAdd, null, tint = MaterialTheme.colorScheme.primary) },
                            modifier = Modifier.clickable { scope.launch { runCatching { repo.subscribe(chat.id) } } },
                        )
                    } else if (chat.myRole != "owner") {
                        ListItem(
                            headlineContent = { Text("Отписаться", color = MaterialTheme.colorScheme.error) },
                            leadingContent = { Icon(Icons.AutoMirrored.Filled.ExitToApp, null, tint = MaterialTheme.colorScheme.error) },
                            modifier = Modifier.clickable { scope.launch { runCatching { repo.leave(chat.id) }.onSuccess { onLeft() } } },
                        )
                    }
                }
            }
            if (chat.type == "group" && chat.myRole != null) {
                if (owner) item {
                    ListItem(
                        headlineContent = { Text("Добавить участников") },
                        leadingContent = { Icon(Icons.Default.PersonAdd, null, tint = MaterialTheme.colorScheme.primary) },
                        modifier = Modifier.clickable(onClick = onAddMembers),
                    )
                }
                items(chat.members.size, key = { chat.members[it].user.id }) { i ->
                    val m = chat.members[i]
                    val u = users[m.user.id] ?: m.user
                    ListItem(
                        headlineContent = { NameWithBadges(u.displayName, u.badges, u.isAdmin, MaterialTheme.typography.bodyLarge, isPremium = u.isPremium, emojiStatus = u.emojiStatus) },
                        supportingContent = { Text(if (m.role == "owner") "владелец" else formatLastSeen(u.online, u.lastSeen)) },
                        leadingContent = { Avatar(u.displayName, repo.avatarUrl(u.avatarFileId), 44.dp, online = u.online) },
                        trailingContent = {
                            if (owner && u.id != myId) IconButton(onClick = {
                                scope.launch { runCatching { repo.removeMember(chat.id, u.id) } }
                            }) { Icon(Icons.Default.PersonRemove, "Исключить") }
                        },
                        modifier = Modifier.animateItem().clickable { onOpenProfile(u.id) },
                    )
                }
                item {
                    ListItem(
                        headlineContent = { Text("Покинуть группу", color = MaterialTheme.colorScheme.error) },
                        leadingContent = { Icon(Icons.AutoMirrored.Filled.ExitToApp, null, tint = MaterialTheme.colorScheme.error) },
                        modifier = Modifier.clickable {
                            scope.launch { runCatching { repo.removeMember(chat.id, myId!!) }.onSuccess { onLeft() } }
                        },
                    )
                }
            }
        }
    }

    if (renaming && chat != null) {
        AlertDialog(
            onDismissRequest = { renaming = false },
            title = { Text(if (chat.type == "channel") "Канал" else "Группа") },
            text = {
                Column {
                    OutlinedTextField(newTitle, { newTitle = it.take(128) }, singleLine = true, label = { Text("Название") })
                    if (chat.type == "channel" || chat.type == "group") {
                        Spacer(Modifier.height(8.dp))
                        OutlinedTextField(newDescription, { newDescription = it.take(500) }, label = { Text("Описание") }, maxLines = 5)
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    renaming = false
                    scope.launch {
                        runCatching {
                            repo.updateChannel(chat.id, newTitle.trim(), newDescription.trim())
                        }
                    }
                }) { Text("Сохранить") }
            },
            dismissButton = { TextButton(onClick = { renaming = false }) { Text("Отмена") } },
        )
    }
}
