package app.ryzik.chat.ui.chats

import androidx.compose.material3.Surface
import androidx.compose.material3.SwipeToDismissBox
import androidx.compose.material3.SwipeToDismissBoxValue
import androidx.compose.material3.rememberSwipeToDismissBoxState
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.clickable
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.defaultMinSize
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Archive
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Unarchive
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExtendedFloatingActionButton
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.nestedscroll.nestedScroll
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import app.ryzik.chat.RyzikApp
import app.ryzik.chat.ui.channel.InviteDialog
import app.ryzik.chat.ui.channel.membersText
import app.ryzik.chat.ui.channel.parseInviteCode
import app.ryzik.chat.data.AuthState
import app.ryzik.chat.data.Chat
import app.ryzik.chat.data.User
import app.ryzik.chat.ui.components.Avatar
import app.ryzik.chat.ui.components.BadgeIcons
import app.ryzik.chat.ui.components.TypingDots
import app.ryzik.chat.ui.components.formatListTime
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/** Свайп чата влево — в архив (или обратно из архива). */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ArchiveSwipe(enabled: Boolean, archived: Boolean, onSwiped: () -> Unit, modifier: Modifier, content: @Composable () -> Unit) {
    if (!enabled) { Box(modifier) { content() }; return }
    val currentOnSwiped by androidx.compose.runtime.rememberUpdatedState(onSwiped)
    val state = rememberSwipeToDismissBoxState(
        confirmValueChange = {
            if (it == SwipeToDismissBoxValue.EndToStart) currentOnSwiped()
            false // строка возвращается на место, а чат уезжает в архив сам
        },
        positionalThreshold = { it * 0.35f },
    )
    SwipeToDismissBox(
        state = state,
        enableDismissFromStartToEnd = false,
        modifier = modifier,
        backgroundContent = {
            val active = state.targetValue == SwipeToDismissBoxValue.EndToStart
            val bg by androidx.compose.animation.animateColorAsState(
                if (active) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.secondaryContainer, label = "swipe",
            )
            val iconScale by animateFloatAsState(if (active) 1.2f else 0.9f, spring(Spring.DampingRatioMediumBouncy), label = "swipeIcon")
            Row(
                Modifier.fillMaxSize().background(bg).padding(horizontal = 24.dp),
                horizontalArrangement = Arrangement.End,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                val tint = if (active) MaterialTheme.colorScheme.onPrimary else MaterialTheme.colorScheme.onSecondaryContainer
                Column(horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(if (archived) Icons.Default.Unarchive else Icons.Default.Archive, null, Modifier.graphicsLayer { scaleX = iconScale; scaleY = iconScale }, tint = tint)
                    Text(if (archived) "Вернуть" else "В архив", style = MaterialTheme.typography.labelSmall, color = tint)
                }
            }
        },
    ) { content() }
}

private enum class Filter(val title: String) { All("Все"), Unread("Непрочитанные"), Personal("Личные"), Groups("Группы"), Channels("Каналы") }

@OptIn(ExperimentalMaterial3Api::class, ExperimentalFoundationApi::class)
@Composable
fun ChatListScreen(
    onOpenChat: (String) -> Unit,
    onNewChat: () -> Unit,
    onNewGroup: () -> Unit,
    onNewChannel: () -> Unit,
    onOpenSettings: () -> Unit,
    onOpenProfile: (String) -> Unit,
) {
    val app = RyzikApp.instance
    val repo = app.repo
    val chats by repo.chats.collectAsState()
    val users by repo.users.collectAsState()
    val typing by repo.typing.collectAsState()
    val connected by repo.connected.collectAsState()
    val loading by repo.chatsLoading.collectAsState()
    val auth by repo.auth.collectAsState()
    val settings by app.prefs.settings.collectAsState(initial = null)
    val me = (auth as? AuthState.LoggedIn)?.me
    val scope = rememberCoroutineScope()

    var searching by remember { mutableStateOf(false) }
    var query by remember { mutableStateOf("") }
    var foundUsers by remember { mutableStateOf<List<User>>(emptyList()) }
    var foundChannels by remember { mutableStateOf<List<Chat>>(emptyList()) }
    var fabOpen by remember { mutableStateOf(false) }
    var filter by remember { mutableStateOf(Filter.All) }
    var showArchive by remember { mutableStateOf(false) }
    var menuChat by remember { mutableStateOf<Chat?>(null) }
    var openInvite by remember { mutableStateOf<String?>(null) }
    openInvite?.let { code ->
        InviteDialog(code, onDismiss = { openInvite = null }, onOpenChat = { id -> openInvite = null; onOpenChat(id) })
    }

    LaunchedEffect(query) {
        if (query.length < 2) { foundUsers = emptyList(); return@LaunchedEffect }
        delay(300)
        foundUsers = runCatching { repo.searchUsers(query) }.getOrDefault(emptyList())
        foundChannels = runCatching { repo.searchChannels(query) }.getOrDefault(emptyList()).filter { c -> chats.none { it.id == c.id && it.myRole != null } }
    }

    val listState = rememberLazyListState()
    val expandedFab by remember { derivedStateOf { listState.firstVisibleItemIndex == 0 } }
    val scroll = TopAppBarDefaults.pinnedScrollBehavior()

    val archivedCount = chats.count { it.archived }
    val visible = chats.filter { c ->
        val title = repo.chatTitle(c)
        !((c.type == "channel" || c.type == "group") && c.myRole == null) &&
        (if (showArchive) c.archived else !c.archived) &&
            (query.isBlank() || title.contains(query, ignoreCase = true)) &&
            when (filter) {
                Filter.All -> true
                Filter.Unread -> c.unread > 0
                Filter.Personal -> c.type == "direct" || c.type == "saved"
                Filter.Groups -> c.type == "group"
                Filter.Channels -> c.type == "channel"
            }
    }

    Scaffold(
        modifier = Modifier.nestedScroll(scroll.nestedScrollConnection),
        topBar = {
            Column {
                TopAppBar(
                    scrollBehavior = scroll,
                    navigationIcon = {
                        AnimatedContent(searching || showArchive, label = "nav") { back ->
                            if (back) IconButton(onClick = { searching = false; query = ""; showArchive = false }) {
                                Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад")
                            } else IconButton(onClick = onOpenSettings) {
                                Avatar(me?.displayName ?: "?", repo.avatarUrl(me?.avatarFileId), 34.dp)
                            }
                        }
                    },
                    title = {
                        AnimatedContent(searching, label = "title", transitionSpec = { fadeIn() togetherWith fadeOut() }) { s ->
                            if (s) TextField(
                                value = query,
                                onValueChange = { query = it },
                                placeholder = { Text("Поиск чатов и людей") },
                                singleLine = true,
                                colors = TextFieldDefaults.colors(
                                    focusedContainerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0f),
                                    unfocusedContainerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0f),
                                    focusedIndicatorColor = MaterialTheme.colorScheme.surface.copy(alpha = 0f),
                                    unfocusedIndicatorColor = MaterialTheme.colorScheme.surface.copy(alpha = 0f),
                                ),
                                modifier = Modifier.fillMaxWidth(),
                            ) else Column {
                                Text(if (showArchive) "Архив" else "RyzikChat", fontWeight = FontWeight.Bold)
                                AnimatedVisibility(!connected) {
                                    Row(verticalAlignment = Alignment.CenterVertically) {
                                        Text("Соединение", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                        Spacer(Modifier.width(4.dp))
                                        TypingDots(MaterialTheme.colorScheme.onSurfaceVariant, 3.dp)
                                    }
                                }
                            }
                        }
                    },
                    actions = {
                        AnimatedContent(searching, label = "act") { s ->
                            if (s) IconButton(onClick = { query = "" }) { Icon(Icons.Default.Close, "Очистить") }
                            else IconButton(onClick = { searching = true }) { Icon(Icons.Default.Search, "Поиск") }
                        }
                    },
                )
                AnimatedVisibility(!searching && !showArchive) {
                    LazyRow(
                        contentPadding = PaddingValues(horizontal = 12.dp),
                        horizontalArrangement = Arrangement.spacedBy(8.dp),
                        modifier = Modifier.padding(bottom = 4.dp),
                    ) {
                        items(Filter.entries) { f ->
                            FilterChip(selected = filter == f, onClick = { filter = f }, label = { Text(f.title) })
                        }
                    }
                }
                AnimatedVisibility(loading && chats.isEmpty()) { LinearProgressIndicator(Modifier.fillMaxWidth()) }
            }
        },
        floatingActionButton = {
            AnimatedVisibility(!searching, enter = scaleIn(spring(Spring.DampingRatioMediumBouncy)), exit = scaleOut()) {
                SpeedDial(
                    open = fabOpen,
                    expanded = expandedFab,
                    onToggle = { fabOpen = !fabOpen },
                    items = listOf(
                        DialItem("Новый канал", Icons.Default.Campaign) { fabOpen = false; onNewChannel() },
                        DialItem("Новая группа", Icons.Default.Group) { fabOpen = false; onNewGroup() },
                        DialItem("Новый чат", Icons.Default.Person) { fabOpen = false; onNewChat() },
                    ),
                )
            }
        },
    ) { padding ->
        PullToRefreshBox(
            isRefreshing = loading,
            onRefresh = { scope.launch { repo.refreshChats() } },
            modifier = Modifier.fillMaxSize().padding(padding),
        ) {
            LazyColumn(state = listState, modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(bottom = 96.dp)) {
                if (!searching && !showArchive && archivedCount > 0) {
                    item(key = "archive") {
                        ListItem(
                            headlineContent = { Text("Архив") },
                            supportingContent = { Text("Чатов: $archivedCount") },
                            leadingContent = {
                                Box(Modifier.size(56.dp).clip(CircleShape).background(MaterialTheme.colorScheme.secondaryContainer), contentAlignment = Alignment.Center) {
                                    Icon(Icons.Default.Archive, null, tint = MaterialTheme.colorScheme.onSecondaryContainer)
                                }
                            },
                            modifier = Modifier.animateItem().combinedClickable(onClick = { showArchive = true }),
                        )
                    }
                }
                items(visible, key = { it.id }) { chat ->
                    ArchiveSwipe(
                        enabled = chat.type != "saved" && !chat.isService,
                        archived = chat.archived,
                        onSwiped = { scope.launch { runCatching { repo.setArchived(chat.id, !chat.archived) } } },
                        modifier = Modifier.animateItem(),
                    ) {
                    ChatRow(
                        chat = chat,
                        title = repo.chatTitle(chat),
                        peer = repo.peerOf(chat)?.let { users[it.id] ?: it },
                        preview = repo.previewOf(chat.lastMessage),
                        typingNames = typing[chat.id].orEmpty().keys.mapNotNull { users[it]?.displayName },
                        myId = me?.id,
                        compact = settings?.compactList == true,
                        avatarUrl = repo.avatarUrl(if (chat.type == "direct") repo.peerOf(chat)?.avatarFileId else chat.avatarFileId),
                        modifier = Modifier
                            .background(MaterialTheme.colorScheme.surface)
                            .combinedClickable(onClick = { onOpenChat(chat.id) }, onLongClick = { menuChat = chat }),
                    )
                    }
                }
                if (searching && foundUsers.isNotEmpty()) {
                    item(key = "people") {
                        Text(
                            "Люди",
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 4.dp),
                        )
                    }
                    items(foundUsers, key = { "u_" + it.id }) { u ->
                        ListItem(
                            headlineContent = {
                                Row(verticalAlignment = Alignment.CenterVertically) {
                                    Text(u.displayName, maxLines = 1, overflow = TextOverflow.Ellipsis)
                                    BadgeIcons(u.badges, u.isAdmin, isPremium = u.isPremium, emojiStatus = u.emojiStatus)
                                }
                            },
                            supportingContent = { Text("@${u.username}") },
                            leadingContent = { Avatar(u.displayName, repo.avatarUrl(u.avatarFileId), 48.dp, online = u.online) },
                            modifier = Modifier.animateItem().combinedClickable(
                                onClick = {
                                    scope.launch {
                                        runCatching { repo.openDirect(u.id) }.onSuccess { onOpenChat(it.id) }
                                    }
                                },
                                onLongClick = { onOpenProfile(u.id) },
                            ),
                        )
                    }
                }
                val inviteCode = if (query.contains("join/")) parseInviteCode(query) else null
                if (inviteCode != null) {
                    item(key = "invite") {
                        ListItem(
                            headlineContent = { Text("Открыть приглашение") },
                            supportingContent = { Text("Вступить в группу или канал по ссылке") },
                            leadingContent = { Icon(Icons.Default.Link, null, tint = MaterialTheme.colorScheme.primary) },
                            modifier = Modifier.clickable { openInvite = inviteCode },
                        )
                    }
                }
                if (searching && foundChannels.isNotEmpty()) {
                    item(key = "channels") {
                        Text(
                            "Каналы и группы",
                            style = MaterialTheme.typography.titleSmall,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.padding(start = 16.dp, top = 16.dp, bottom = 4.dp),
                        )
                    }
                    items(foundChannels, key = { "c_" + it.id }) { c ->
                        ListItem(
                            headlineContent = { Text(c.title, maxLines = 1, overflow = TextOverflow.Ellipsis) },
                            supportingContent = { Text((if (c.type == "group") membersText(c.memberCount) else subscribersText(c.memberCount)) + c.description.takeIf { it.isNotBlank() }?.let { " · $it" }.orEmpty(), maxLines = 1, overflow = TextOverflow.Ellipsis) },
                            leadingContent = { Avatar(c.title, repo.avatarUrl(c.avatarFileId), 48.dp) },
                            modifier = Modifier.animateItem().combinedClickable(onClick = { onOpenChat(c.id) }),
                        )
                    }
                }
                if (visible.isEmpty() && !loading && !(searching && (foundUsers.isNotEmpty() || foundChannels.isNotEmpty()))) {
                    item(key = "empty") { EmptyState(searching, Modifier.animateItem()) }
                }
            }
        }
    }

    menuChat?.let { chat ->
        ModalBottomSheet(onDismissRequest = { menuChat = null }) {
            Text(
                repo.chatTitle(chat),
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp),
            )
            fun act(block: suspend () -> Unit) {
                menuChat = null
                scope.launch { runCatching { block() } }
            }
            ListItem(
                headlineContent = { Text(if (chat.pinned) "Открепить" else "Закрепить") },
                leadingContent = { Icon(Icons.Default.PushPin, null) },
                modifier = Modifier.combinedClickable(onClick = { act { repo.setPinned(chat.id, !chat.pinned) } }),
            )
            ListItem(
                headlineContent = { Text(if (chat.muted) "Включить уведомления" else "Без звука") },
                leadingContent = { Icon(if (chat.muted) Icons.Default.Notifications else Icons.Default.NotificationsOff, null) },
                modifier = Modifier.combinedClickable(onClick = { act { repo.setMuted(chat.id, !chat.muted) } }),
            )
            if (chat.type != "saved" && !chat.isService) {
                ListItem(
                    headlineContent = { Text(if (chat.archived) "Вернуть из архива" else "В архив") },
                    leadingContent = { Icon(if (chat.archived) Icons.Default.Unarchive else Icons.Default.Archive, null) },
                    modifier = Modifier.combinedClickable(onClick = { act { repo.setArchived(chat.id, !chat.archived) } }),
                )
            }
            if (chat.type == "channel" && chat.myRole != "owner" && !chat.isService) {
                ListItem(
                    headlineContent = { Text("Отписаться", color = MaterialTheme.colorScheme.error) },
                    leadingContent = { Icon(Icons.AutoMirrored.Filled.ExitToApp, null, tint = MaterialTheme.colorScheme.error) },
                    modifier = Modifier.combinedClickable(onClick = { act { repo.leave(chat.id) } }),
                )
            }
            if (chat.type == "group") {
                ListItem(
                    headlineContent = { Text("Покинуть группу", color = MaterialTheme.colorScheme.error) },
                    leadingContent = { Icon(Icons.AutoMirrored.Filled.ExitToApp, null, tint = MaterialTheme.colorScheme.error) },
                    modifier = Modifier.combinedClickable(onClick = { act { repo.removeMember(chat.id, me!!.id) } }),
                )
            }
            Spacer(Modifier.height(32.dp))
        }
    }
}

@Composable
private fun ChatRow(
    chat: Chat,
    title: String,
    peer: User?,
    preview: String,
    typingNames: List<String>,
    myId: String?,
    compact: Boolean,
    avatarUrl: String?,
    modifier: Modifier,
) {
    val scheme = MaterialTheme.colorScheme
    val avatarSize = if (compact) 44.dp else 56.dp
    Row(
        modifier
            .fillMaxWidth()
            .padding(horizontal = 12.dp, vertical = if (compact) 6.dp else 8.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Avatar(title, avatarUrl, avatarSize, online = peer?.online == true, saved = chat.type == "saved", service = chat.isService)
        Spacer(Modifier.width(12.dp))
        Column(Modifier.weight(1f)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f), verticalAlignment = Alignment.CenterVertically) {
                    Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                    if (chat.isService) Icon(Icons.Default.Verified, "Официальный чат", Modifier.padding(start = 4.dp).size(16.dp), tint = scheme.primary)
                    else if (chat.type == "channel") Icon(Icons.Default.Campaign, null, Modifier.padding(start = 4.dp).size(16.dp), tint = scheme.primary)
                    if (peer != null) BadgeIcons(peer.badges, peer.isAdmin, 16.dp, peer.isPremium, peer.emojiStatus)
                    if (chat.muted) Icon(Icons.Default.NotificationsOff, null, Modifier.padding(start = 4.dp).size(14.dp), tint = scheme.outline)
                }
                val last = chat.lastMessage
                if (last != null && last.senderId == myId && chat.type != "saved") {
                    Icon(Icons.Default.DoneAll, null, Modifier.size(16.dp), tint = scheme.primary)
                    Spacer(Modifier.width(4.dp))
                }
                Text(
                    formatListTime(chat.lastMessage?.createdAt ?: chat.createdAt),
                    style = MaterialTheme.typography.labelMedium,
                    color = if (chat.unread > 0) scheme.primary else scheme.onSurfaceVariant,
                )
            }
            Spacer(Modifier.height(2.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.weight(1f)) {
                    AnimatedContent(typingNames.isNotEmpty(), label = "typing", transitionSpec = { fadeIn() togetherWith fadeOut() }) { isTyping ->
                        if (isTyping) Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(
                                if (chat.type == "group") "${typingNames.first()} печатает" else "печатает",
                                style = MaterialTheme.typography.bodyMedium,
                                color = scheme.primary,
                            )
                            Spacer(Modifier.width(4.dp))
                            TypingDots(scheme.primary, 4.dp)
                        } else Row(verticalAlignment = Alignment.CenterVertically) {
                            if (chat.type != "saved" && chat.type != "channel" && chat.lastMessage != null) {
                                Icon(Icons.Default.Lock, null, Modifier.size(12.dp), tint = scheme.outline)
                                Spacer(Modifier.width(4.dp))
                            }
                            Text(
                                preview.ifEmpty {
                                    when {
                                        chat.type == "saved" -> "Сохраняйте сюда важное"
                                        chat.isService -> "Коды входа и важные новости"
                                        else -> "Нет сообщений"
                                    }
                                },
                                style = MaterialTheme.typography.bodyMedium,
                                color = scheme.onSurfaceVariant,
                                maxLines = if (compact) 1 else 2,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                    }
                }
                if (chat.pinned && chat.unread == 0) {
                    Icon(Icons.Default.PushPin, null, Modifier.size(16.dp), tint = scheme.outline)
                }
                UnreadBadge(chat.unread, chat.muted)
            }
        }
    }
}

@Composable
private fun UnreadBadge(count: Int, muted: Boolean) {
    val scale by animateFloatAsState(if (count > 0) 1f else 0f, spring(Spring.DampingRatioMediumBouncy), label = "unread")
    if (scale <= 0.01f) return
    val scheme = MaterialTheme.colorScheme
    Box(
        Modifier
            .padding(start = 6.dp)
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .defaultMinSize(minWidth = 22.dp, minHeight = 22.dp)
            .clip(RoundedCornerShape(11.dp))
            .background(if (muted) scheme.outline else scheme.primary)
            .padding(horizontal = 6.dp),
        contentAlignment = Alignment.Center,
    ) {
        AnimatedContent(count, label = "count") { c ->
            Text(if (c > 999) "999+" else c.coerceAtLeast(1).toString(), style = MaterialTheme.typography.labelSmall, color = scheme.onPrimary)
        }
    }
}

@Composable
private fun EmptyState(searching: Boolean, modifier: Modifier) {
    Column(modifier.fillMaxWidth().padding(48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(if (searching) "🔍" else "💬", style = MaterialTheme.typography.displayMedium)
        Spacer(Modifier.height(12.dp))
        Text(
            if (searching) "Ничего не нашлось" else "Здесь пока пусто. Нажмите на карандаш в углу, чтобы написать другу, создать группу или канал.",
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

fun subscribersText(n: Int): String {
    val mod10 = n % 10
    val mod100 = n % 100
    val word = when {
        mod10 == 1 && mod100 != 11 -> "подписчик"
        mod10 in 2..4 && mod100 !in 12..14 -> "подписчика"
        else -> "подписчиков"
    }
    return "$n $word"
}

private class DialItem(val label: String, val icon: androidx.compose.ui.graphics.vector.ImageVector, val onClick: () -> Unit)

/** Кнопка в углу: раскрывается в «Новый чат / группа / канал» с пружинкой. */
@Composable
private fun SpeedDial(open: Boolean, expanded: Boolean, onToggle: () -> Unit, items: List<DialItem>) {
    val rotation by animateFloatAsState(if (open) 135f else 0f, spring(Spring.DampingRatioMediumBouncy), label = "rot")
    Column(horizontalAlignment = Alignment.End) {
        items.forEachIndexed { i, item ->
            val delayMs = (items.size - 1 - i) * 40
            AnimatedVisibility(
                visible = open,
                enter = fadeIn(androidx.compose.animation.core.tween(150, delayMs)) +
                    scaleIn(spring(Spring.DampingRatioMediumBouncy, Spring.StiffnessMedium), initialScale = 0.4f, transformOrigin = androidx.compose.ui.graphics.TransformOrigin(1f, 1f)) +
                    androidx.compose.animation.slideInVertically(spring(Spring.DampingRatioMediumBouncy)) { it },
                exit = fadeOut() + scaleOut(targetScale = 0.6f),
            ) {
                Row(Modifier.padding(bottom = 12.dp, end = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Surface(shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceContainerHighest, shadowElevation = 2.dp, onClick = item.onClick) {
                        Text(item.label, style = MaterialTheme.typography.labelLarge, modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp))
                    }
                    Spacer(Modifier.width(12.dp))
                    androidx.compose.material3.SmallFloatingActionButton(
                        onClick = item.onClick,
                        containerColor = MaterialTheme.colorScheme.secondaryContainer,
                    ) { Icon(item.icon, item.label) }
                }
            }
        }
        ExtendedFloatingActionButton(
            onClick = onToggle,
            expanded = expanded && !open,
            icon = { Icon(Icons.Default.Add, null, Modifier.graphicsLayer { rotationZ = rotation }) },
            text = { Text("Создать") },
        )
    }
}
