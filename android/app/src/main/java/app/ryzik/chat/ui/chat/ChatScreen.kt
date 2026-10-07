package app.ryzik.chat.ui.chat

import app.ryzik.chat.notify.Notifier
import kotlinx.coroutines.delay
import app.ryzik.chat.ui.components.formatDuration
import app.ryzik.chat.ui.chats.subscribersText
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.foundation.gestures.waitForUpOrCancellation
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.animation.core.tween
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.mutableFloatStateOf
import androidx.compose.material3.TextButton
import androidx.compose.material3.Button
import androidx.compose.material.icons.automirrored.filled.ExitToApp
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CropSquare
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Videocam
import androidx.compose.material.icons.filled.Call
import androidx.core.content.ContextCompat
import android.content.pm.PackageManager
import android.Manifest
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.net.Uri
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.InsertDriveFile
import androidx.compose.material.icons.automirrored.filled.Reply
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.AttachFile
import androidx.compose.material.icons.filled.Bookmark
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ContentCopy
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.Photo
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material.icons.filled.Share
import androidx.compose.material.icons.filled.Check
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FilledIconButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.SmallFloatingActionButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.TopAppBarDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import app.ryzik.chat.RyzikApp
import app.ryzik.chat.data.AppSettings
import app.ryzik.chat.data.AuthState
import app.ryzik.chat.data.SendStatus
import app.ryzik.chat.data.UiMessage
import app.ryzik.chat.data.userMessage
import app.ryzik.chat.ui.components.Avatar
import app.ryzik.chat.ui.components.BadgeIcons
import app.ryzik.chat.ui.components.TypingDots
import app.ryzik.chat.ui.components.formatDay
import app.ryzik.chat.ui.components.formatLastSeen
import app.ryzik.chat.ui.components.isSameDay
import app.ryzik.chat.ui.theme.wallpaperColors
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch

val QuickReactions = listOf("❤️", "👍", "😂", "🔥", "😮", "😢", "🎉", "👎", "🙏", "🤝")

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ChatScreen(
    chatId: String,
    onBack: () -> Unit,
    onOpenInfo: () -> Unit,
    onOpenMedia: (String) -> Unit,
) {
    val app = RyzikApp.instance
    val repo = app.repo
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

    val chats by repo.chats.collectAsState()
    val chat = chats.firstOrNull { it.id == chatId }
    val messages by repo.messagesOf(chatId).collectAsState()
    val users by repo.users.collectAsState()
    val typing by repo.typing.collectAsState()
    val readStates by repo.readStates.collectAsState()
    val auth by repo.auth.collectAsState()
    val settings by app.prefs.settings.collectAsState(initial = AppSettings())
    val myId = (auth as? AuthState.LoggedIn)?.me?.id

    var input by remember { mutableStateOf("") }
    var replyTo by remember { mutableStateOf<UiMessage?>(null) }
    var editing by remember { mutableStateOf<UiMessage?>(null) }
    var menuFor by remember { mutableStateOf<UiMessage?>(null) }
    var forwarding by remember { mutableStateOf<UiMessage?>(null) }
    var showAttach by remember { mutableStateOf(false) }
    var showMenu by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val openedAt = remember { System.currentTimeMillis() }
    var lastTypingSent by remember { mutableLongStateOf(0L) }

    // Голосовые и квадратики
    val premium = (auth as? AuthState.LoggedIn)?.me?.isPremium == true
    val voiceLimit = if (premium) 30 * 60_000L else 10 * 60_000L
    val squareLimit = if (premium) 120_000L else 60_000L
    var recordMode by remember { mutableStateOf("voice") }
    val voiceRecorder = remember { VoiceRecorder(context) }
    val squareRecorder = remember { SquareRecorder(context) }
    var recordingVoice by remember { mutableStateOf(false) }
    var voiceLevel by remember { mutableFloatStateOf(0f) }
    var voiceElapsed by remember { mutableLongStateOf(0L) }
    var dragX by remember { mutableFloatStateOf(0f) }
    val cancelDistance = 120f * context.resources.displayMetrics.density
    squareRecorder.onReady = { f, duration ->
        val (w, h) = videoSize(f)
        repo.sendRecorded(chatId, f, "square", "video/mp4", duration, width = w, height = h, replyTo = replyTo?.id)
        replyTo = null
    }
    fun finishVoice(send: Boolean) {
        if (!recordingVoice) return
        recordingVoice = false
        if (send) {
            voiceRecorder.stop()?.let { r ->
                repo.sendRecorded(chatId, r.file, "voice", "audio/mp4", r.durationMs, waveform = r.waveform, replyTo = replyTo?.id)
                replyTo = null
            }
        } else voiceRecorder.cancel()
    }
    LaunchedEffect(recordingVoice) {
        while (recordingVoice) {
            voiceLevel = voiceRecorder.level()
            voiceElapsed = voiceRecorder.elapsed()
            if (voiceElapsed >= voiceLimit) finishVoice(true)
            delay(100)
        }
    }
    DisposableEffect(Unit) {
        onDispose {
            if (voiceRecorder.isRecording) voiceRecorder.cancel()
            InlinePlayer.stop()
        }
    }
    val recordPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) {}
    fun hasPermission(p: String) = ContextCompat.checkSelfPermission(context, p) == PackageManager.PERMISSION_GRANTED

    // Звонки
    var pendingCallVideo by remember { mutableStateOf<Boolean?>(null) }
    val callPermission = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { res ->
        val video = pendingCallVideo ?: return@rememberLauncherForActivityResult
        pendingCallVideo = null
        val peerId = chat?.let { repo.peerOf(it) }?.id ?: return@rememberLauncherForActivityResult
        if (res[Manifest.permission.RECORD_AUDIO] == true) app.calls.startCall(peerId, video && res[Manifest.permission.CAMERA] == true)
        else error = "Для звонка нужен доступ к микрофону"
    }
    fun startCall(video: Boolean) {
        val peerId = chat?.let { repo.peerOf(it) }?.id ?: return
        val needed = buildList {
            add(Manifest.permission.RECORD_AUDIO)
            if (video) add(Manifest.permission.CAMERA)
        }
        if (needed.all { hasPermission(it) }) app.calls.startCall(peerId, video)
        else { pendingCallVideo = video; callPermission.launch(needed.toTypedArray()) }
    }

    DisposableEffect(chatId) {
        Notifier.clearChat(context, chatId)
        repo.openChatId = chatId
        onDispose { if (repo.openChatId == chatId) repo.openChatId = null }
    }
    LaunchedEffect(chatId) {
        val c = repo.chat(chatId) ?: runCatching { repo.loadChat(chatId) }.getOrNull()
        // Сообщения группы зашифрованы для участников: до вступления их не показать.
        if (!(c?.type == "group" && c.myRole == null)) runCatching { repo.loadLatest(chatId) }.onFailure { error = it.userMessage() }
    }
    LaunchedEffect(messages.lastOrNull()?.id) { repo.markRead(chatId) }

    val listState = rememberLazyListState()
    val reversed = remember(messages) { messages.asReversed() }

    // Подгрузка старых сообщений при прокрутке вверх
    LaunchedEffect(listState) {
        snapshotFlow { listState.layoutInfo.visibleItemsInfo.lastOrNull()?.index ?: 0 }
            .distinctUntilChanged()
            .filter { it >= reversed.size - 5 }
            .collect { runCatching { repo.loadOlder(chatId) } }
    }
    // Новое своё сообщение — прыгаем вниз
    LaunchedEffect(messages.lastOrNull()?.id) {
        val last = messages.lastOrNull() ?: return@LaunchedEffect
        if (last.senderId == myId || listState.firstVisibleItemIndex <= 2) listState.animateScrollToItem(0)
    }

    val photoPicker = rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(10)) { uris: List<Uri> ->
        uris.forEachIndexed { i, uri -> repo.sendFile(chatId, uri, if (i == 0) input else "", replyTo = replyTo?.id) }
        if (uris.isNotEmpty()) { input = ""; replyTo = null }
    }
    val filePicker = rememberLauncherForActivityResult(ActivityResultContracts.OpenMultipleDocuments()) { uris: List<Uri> ->
        uris.forEach { repo.sendFile(chatId, it, "", asType = "file", replyTo = replyTo?.id) }
        if (uris.isNotEmpty()) replyTo = null
    }

    val title = chat?.let { repo.chatTitle(it) } ?: ""
    val peer = chat?.let { repo.peerOf(it) }?.let { users[it.id] ?: it }
    val typingHere = typing[chatId].orEmpty().keys.filter { it != myId }
    val othersRead = readStates[chatId].orEmpty().filterKeys { it != myId }.values.maxOrNull() ?: 0L

    fun send() {
        val text = input.trim()
        if (text.isEmpty()) return
        val e = editing
        if (e != null) {
            scope.launch { runCatching { repo.editMessage(e, text) }.onFailure { error = it.userMessage() } }
            editing = null
        } else {
            repo.sendText(chatId, text, replyTo?.id)
            replyTo = null
        }
        input = ""
    }

    Box(Modifier.fillMaxSize().background(Brush.verticalGradient(wallpaperColors(settings.wallpaper)))) {
        Column(Modifier.fillMaxSize()) {
            TopAppBar(
                colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.surfaceContainer),
                navigationIcon = { IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Назад") } },
                title = {
                    Row(Modifier.clickable(onClick = onOpenInfo), verticalAlignment = Alignment.CenterVertically) {
                        Avatar(
                            title,
                            repo.avatarUrl(if (chat?.type == "direct") peer?.avatarFileId else chat?.avatarFileId),
                            40.dp,
                            online = peer?.online == true,
                            saved = chat?.type == "saved",
                        )
                        Spacer(Modifier.width(12.dp))
                        Column {
                            Row(verticalAlignment = Alignment.CenterVertically) {
                                Text(title, style = MaterialTheme.typography.titleMedium, maxLines = 1, overflow = TextOverflow.Ellipsis, modifier = Modifier.weight(1f, fill = false))
                                if (peer != null) BadgeIcons(peer.badges, peer.isAdmin, 16.dp, peer.isPremium, peer.emojiStatus)
                            }
                            AnimatedContent(
                                targetState = when {
                                    typingHere.isNotEmpty() && settings.showTyping -> "typing"
                                    else -> "status"
                                },
                                label = "subtitle",
                                transitionSpec = { (slideInVertically { it } + fadeIn()) togetherWith (slideOutVertically { -it } + fadeOut()) },
                            ) { s ->
                                if (s == "typing") Row(verticalAlignment = Alignment.CenterVertically) {
                                    val who = if (chat?.type == "group") (users[typingHere.first()]?.displayName ?: "") + " " else ""
                                    Text("${who}печатает", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.primary)
                                    Spacer(Modifier.width(4.dp))
                                    TypingDots(MaterialTheme.colorScheme.primary, 4.dp)
                                } else Text(
                                    when (chat?.type) {
                                        "saved" -> "только для вас"
                                        "group" -> "участников: ${chat.members.size}"
                                        "channel" -> subscribersText(chat.memberCount)
                                        else -> peer?.let { formatLastSeen(it.online, it.lastSeen) } ?: ""
                                    },
                                    style = MaterialTheme.typography.labelMedium,
                                    color = if (peer?.online == true) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }
                },
                actions = {
                    if (chat?.type == "direct" && peer != null) {
                        IconButton(onClick = { startCall(false) }) { Icon(Icons.Default.Call, "Звонок") }
                        IconButton(onClick = { startCall(true) }) { Icon(Icons.Default.Videocam, "Видеозвонок") }
                    }
                    Box {
                        IconButton(onClick = { showMenu = true }) { Icon(Icons.Default.MoreVert, "Ещё") }
                        DropdownMenu(showMenu, onDismissRequest = { showMenu = false }) {
                            if (chat != null) {
                                DropdownMenuItem(
                                    text = { Text(if (chat.muted) "Включить звук" else "Без звука") },
                                    leadingIcon = { Icon(if (chat.muted) Icons.Default.Notifications else Icons.Default.NotificationsOff, null) },
                                    onClick = { showMenu = false; scope.launch { runCatching { repo.setMuted(chatId, !chat.muted) } } },
                                )
                                DropdownMenuItem(
                                    text = { Text(if (chat.pinned) "Открепить чат" else "Закрепить чат") },
                                    leadingIcon = { Icon(Icons.Default.PushPin, null) },
                                    onClick = { showMenu = false; scope.launch { runCatching { repo.setPinned(chatId, !chat.pinned) } } },
                                )
                            }
                            if (chat?.type == "channel" && chat.myRole != null && chat.myRole != "owner") {
                                DropdownMenuItem(
                                    text = { Text("Отписаться") },
                                    leadingIcon = { Icon(Icons.AutoMirrored.Filled.ExitToApp, null) },
                                    onClick = {
                                        showMenu = false
                                        scope.launch { runCatching { repo.leave(chatId) }.onSuccess { onBack() }.onFailure { error = it.userMessage() } }
                                    },
                                )
                            }
                            DropdownMenuItem(
                                text = { Text("Информация") },
                                leadingIcon = { Icon(Icons.Default.Lock, null) },
                                onClick = { showMenu = false; onOpenInfo() },
                            )
                        }
                    }
                },
            )

            Box(Modifier.weight(1f)) {
                LazyColumn(
                    state = listState,
                    reverseLayout = true,
                    modifier = Modifier.fillMaxSize(),
                    contentPadding = PaddingValues(vertical = 8.dp),
                ) {
                    if (reversed.isEmpty()) {
                        item(key = "hello") { EmptyChat(chat?.type == "saved", chat?.type == "channel") }
                    }
                    items(reversed.size, key = { reversed[it].id }, contentType = { reversed[it].type }) { i ->
                        val m = reversed[i]
                        val older = reversed.getOrNull(i + 1)
                        val newer = reversed.getOrNull(i - 1)
                        val mine = m.senderId == myId
                        val firstInGroup = older == null || older.senderId != m.senderId || !isSameDay(older.createdAt, m.createdAt) || m.createdAt - older.createdAt > 5 * 60_000
                        val lastInGroup = newer == null || newer.senderId != m.senderId || !isSameDay(newer.createdAt, m.createdAt) || newer.createdAt - m.createdAt > 5 * 60_000
                        Column(Modifier.animateItem()) {
                            if (older == null || !isSameDay(older.createdAt, m.createdAt)) DateChip(m.createdAt)
                            val replied = m.replyTo?.let { id -> messages.firstOrNull { it.id == id } }
                            MessageBubble(
                                msg = m,
                                mine = mine,
                                sender = users[m.senderId],
                                showName = chat?.type == "group" && firstInGroup,
                                firstInGroup = firstInGroup,
                                lastInGroup = lastInGroup,
                                read = settings.showReadReceipts && m.status == SendStatus.Sent && (chat?.type == "saved" || othersRead >= m.seq),
                                replied = replied,
                                repliedSender = replied?.let { users[it.senderId]?.displayName },
                                forwardedName = m.forwardedFrom?.let { users[it]?.displayName ?: "пользователя" },
                                myId = myId,
                                style = BubbleStyle(settings.textSize, settings.bubbleRadius, settings.bigEmoji, settings.swipeToReply, settings.animations),
                                animateIn = m.createdAt > openedAt,
                                autoDownload = settings.autoDownload,
                                users = users,
                                onLongPress = { menuFor = m },
                                onDoubleTap = { if (!m.deleted && m.status == SendStatus.Sent) scope.launch { runCatching { repo.react(m, settings.quickReaction) } } },
                                onReply = { if (m.status == SendStatus.Sent) { editing = null; replyTo = m } },
                                onOpenMedia = { onOpenMedia(m.id) },
                                onReactionClick = { emoji -> scope.launch { runCatching { repo.react(m, emoji) } } },
                                onReplyClick = { id ->
                                    val idx = reversed.indexOfFirst { it.id == id }
                                    if (idx >= 0) scope.launch { listState.animateScrollToItem(idx) }
                                },
                                onRetry = { repo.retry(m) },
                            )
                        }
                    }
                }

                // Кнопка «вниз»
                val showDown by remember { derivedStateOf { listState.firstVisibleItemIndex > 3 } }
                val unread = chat?.unread ?: 0
                androidx.compose.animation.AnimatedVisibility(
                    showDown,
                    modifier = Modifier.align(Alignment.BottomEnd).padding(16.dp),
                    enter = scaleIn(spring(Spring.DampingRatioMediumBouncy)) + fadeIn(),
                    exit = scaleOut() + fadeOut(),
                ) {
                    BadgedBox(badge = { if (unread > 0) Badge { Text(unread.toString()) } }) {
                        SmallFloatingActionButton(onClick = { scope.launch { listState.animateScrollToItem(0) } }) {
                            Icon(Icons.Default.KeyboardArrowDown, "Вниз")
                        }
                    }
                }

                androidx.compose.animation.AnimatedVisibility(
                    error != null,
                    modifier = Modifier.align(Alignment.TopCenter).padding(8.dp),
                    enter = slideInVertically() + fadeIn(),
                    exit = slideOutVertically() + fadeOut(),
                ) {
                    Surface(shape = RoundedCornerShape(16.dp), color = MaterialTheme.colorScheme.errorContainer, onClick = { error = null }) {
                        Text(error.orEmpty(), Modifier.padding(horizontal = 16.dp, vertical = 10.dp), color = MaterialTheme.colorScheme.onErrorContainer)
                    }
                }
            }

            val canPost = chat == null || (chat.type != "channel" && (chat.myRole != null || chat.type == "direct" || chat.type == "saved")) ||
                chat.myRole == "owner" || chat.myRole == "admin"
            if (!canPost && chat != null) {
                ChannelBar(
                    subscribed = chat.myRole != null,
                    joinText = if (chat.type == "group") "Вступить в группу" else "Подписаться",
                    muted = chat.muted,
                    onSubscribe = { scope.launch { runCatching { repo.subscribe(chatId); repo.loadLatest(chatId) }.onFailure { error = it.userMessage() } } },
                    onToggleMute = { scope.launch { runCatching { repo.setMuted(chatId, !chat.muted) } } },
                )
            } else
            // Панель ответа/редактирования
            Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
                Column(Modifier.navigationBarsPadding().imePadding()) {
                    AnimatedVisibility(replyTo != null || editing != null, enter = expandVertically() + fadeIn(), exit = shrinkVertically() + fadeOut()) {
                        val target = editing ?: replyTo
                        Row(Modifier.fillMaxWidth().padding(start = 16.dp, end = 4.dp, top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                            Icon(if (editing != null) Icons.Default.Edit else Icons.AutoMirrored.Filled.Reply, null, tint = MaterialTheme.colorScheme.primary)
                            Spacer(Modifier.width(12.dp))
                            if (target != null) {
                                ReplyQuote(
                                    name = if (editing != null) "Редактирование" else users[target.senderId]?.displayName ?: "",
                                    text = target.content?.let { previewOf(target.type, it.text, it.file) } ?: "",
                                    accent = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.weight(1f),
                                )
                            }
                            IconButton(onClick = { if (editing != null) input = ""; replyTo = null; editing = null }) {
                                Icon(Icons.Default.Close, "Отмена")
                            }
                        }
                    }
                    Row(Modifier.fillMaxWidth().padding(horizontal = 4.dp, vertical = 6.dp), verticalAlignment = Alignment.Bottom) {
                        Box {
                            IconButton(onClick = { showAttach = true }) { Icon(Icons.Default.AttachFile, "Прикрепить") }
                            DropdownMenu(showAttach, onDismissRequest = { showAttach = false }) {
                                DropdownMenuItem(
                                    text = { Text("Фото или видео") },
                                    leadingIcon = { Icon(Icons.Default.Photo, null) },
                                    onClick = {
                                        showAttach = false
                                        photoPicker.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo))
                                    },
                                )
                                DropdownMenuItem(
                                    text = { Text("Файл") },
                                    leadingIcon = { Icon(Icons.AutoMirrored.Filled.InsertDriveFile, null) },
                                    onClick = { showAttach = false; filePicker.launch(arrayOf("*/*")) },
                                )
                            }
                        }
                        if (recordingVoice) {
                            VoiceRecordingBar(voiceElapsed, dragX, cancelDistance, Modifier.weight(1f).height(56.dp))
                        } else TextField(
                            value = input,
                            onValueChange = {
                                input = it
                                val now = System.currentTimeMillis()
                                if (it.isNotBlank() && now - lastTypingSent > 3000) {
                                    lastTypingSent = now
                                    repo.sendTyping(chatId)
                                }
                            },
                            placeholder = { Text("Сообщение") },
                            modifier = Modifier.weight(1f).heightIn(max = 160.dp),
                            shape = RoundedCornerShape(24.dp),
                            colors = TextFieldDefaults.colors(
                                focusedIndicatorColor = MaterialTheme.colorScheme.surface.copy(alpha = 0f),
                                unfocusedIndicatorColor = MaterialTheme.colorScheme.surface.copy(alpha = 0f),
                                focusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHighest,
                                unfocusedContainerColor = MaterialTheme.colorScheme.surfaceContainerHighest,
                            ),
                            keyboardOptions = KeyboardOptions(
                                capitalization = KeyboardCapitalization.Sentences,
                                imeAction = if (settings.sendByEnter) ImeAction.Send else ImeAction.Default,
                            ),
                            keyboardActions = KeyboardActions(onSend = { send() }),
                            singleLine = settings.sendByEnter,
                            maxLines = 6,
                        )
                        Spacer(Modifier.width(6.dp))
                        AnimatedContent(
                            targetState = input.isNotBlank(),
                            label = "send",
                            transitionSpec = { (scaleIn(spring(Spring.DampingRatioMediumBouncy)) + fadeIn()) togetherWith (scaleOut() + fadeOut()) },
                        ) { canSend ->
                            if (canSend) FilledIconButton(onClick = { send() }, modifier = Modifier.size(52.dp)) {
                                Icon(if (editing != null) Icons.Default.Check else Icons.AutoMirrored.Filled.Send, "Отправить")
                            } else RecordButton(
                                mode = recordMode,
                                recording = recordingVoice || squareRecorder.active,
                                level = voiceLevel,
                                onTap = { recordMode = if (recordMode == "voice") "square" else "voice" },
                                onStart = {
                                    val perms = if (recordMode == "voice") listOf(Manifest.permission.RECORD_AUDIO)
                                    else listOf(Manifest.permission.CAMERA, Manifest.permission.RECORD_AUDIO)
                                    if (!perms.all { hasPermission(it) }) {
                                        recordPermission.launch(perms.toTypedArray())
                                        false
                                    } else if (recordMode == "voice") {
                                        InlinePlayer.stop()
                                        recordingVoice = voiceRecorder.start()
                                        if (!recordingVoice) error = "Не удалось включить микрофон"
                                        recordingVoice
                                    } else {
                                        InlinePlayer.stop()
                                        squareRecorder.begin()
                                        true
                                    }
                                },
                                onDrag = { dragX = it },
                                onEnd = { cancel ->
                                    dragX = 0f
                                    if (recordMode == "voice") finishVoice(!cancel)
                                    else {
                                        if (!cancel && squareRecorder.elapsed() < 800) error = "Держите кнопку, пока идёт запись квадратика"
                                        squareRecorder.finish(send = !cancel)
                                    }
                                },
                                cancelDistance = cancelDistance,
                            )
                        }
                    }
                }
            }
        }
    }

    if (squareRecorder.active) {
        SquareRecordingOverlay(squareRecorder, squareLimit, (-dragX / cancelDistance).coerceIn(0f, 1f))
    }

    // Меню сообщения
    menuFor?.let { m ->
        val mine = m.senderId == myId
        ModalBottomSheet(onDismissRequest = { menuFor = null }) {
            if (!m.deleted && m.status == SendStatus.Sent) {
                LazyRow(
                    contentPadding = PaddingValues(horizontal = 16.dp),
                    horizontalArrangement = Arrangement.spacedBy(6.dp),
                    modifier = Modifier.padding(bottom = 8.dp),
                ) {
                    items(QuickReactions) { e ->
                        val selected = m.reactions.any { it.userId == myId && it.emoji == e }
                        Box(
                            Modifier
                                .size(48.dp)
                                .clip(CircleShape)
                                .background(if (selected) MaterialTheme.colorScheme.primaryContainer else MaterialTheme.colorScheme.surfaceContainerHigh)
                                .clickable {
                                    menuFor = null
                                    scope.launch { runCatching { repo.react(m, e) } }
                                },
                            contentAlignment = Alignment.Center,
                        ) { Text(e, fontSize = 24.sp) }
                    }
                }
                HorizontalDivider()
            }
            if (m.status == SendStatus.Failed) {
                SheetItem("Отправить ещё раз", Icons.Default.Refresh) { menuFor = null; repo.retry(m) }
            }
            if (!m.deleted && m.status == SendStatus.Sent) {
                SheetItem("Ответить", Icons.AutoMirrored.Filled.Reply) { menuFor = null; editing = null; replyTo = m }
            }
            if (!m.content?.text.isNullOrEmpty()) {
                SheetItem("Копировать текст", Icons.Default.ContentCopy) {
                    menuFor = null
                    copy(context, m.content!!.text)
                }
            }
            if (mine && !m.deleted && m.status == SendStatus.Sent && m.content != null) {
                SheetItem("Изменить", Icons.Default.Edit) {
                    menuFor = null
                    replyTo = null
                    editing = m
                    input = m.content.text
                }
            }
            if (!m.deleted && m.content != null && m.status == SendStatus.Sent) {
                if (chat?.type != "saved") {
                    SheetItem("В Избранное", Icons.Default.Bookmark) { menuFor = null; repo.saveToFavorites(m) }
                }
                SheetItem("Переслать", Icons.Default.Share) { menuFor = null; forwarding = m }
            }
            val me = (auth as? AuthState.LoggedIn)?.me
            val canDelete = mine || me?.isAdmin == true || chat?.myRole == "owner" || (chat?.type == "channel" && chat.myRole == "admin") ||
                chat?.members?.any { it.user.id == myId && it.role == "owner" } == true
            if (!m.deleted && canDelete) {
                SheetItem("Удалить", Icons.Default.Delete, danger = true) {
                    menuFor = null
                    scope.launch { runCatching { repo.deleteMessage(m) }.onFailure { error = it.userMessage() } }
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }

    forwarding?.let { m ->
        ModalBottomSheet(onDismissRequest = { forwarding = null }) {
            Text("Переслать в…", style = MaterialTheme.typography.titleLarge, modifier = Modifier.padding(horizontal = 24.dp, vertical = 8.dp))
            LazyColumn(Modifier.heightIn(max = 480.dp)) {
                items(chats, key = { it.id }) { c ->
                    ListItem(
                        headlineContent = { Text(repo.chatTitle(c)) },
                        leadingContent = {
                            Avatar(repo.chatTitle(c), repo.avatarUrl(if (c.type == "direct") repo.peerOf(c)?.avatarFileId else c.avatarFileId), 40.dp, saved = c.type == "saved")
                        },
                        modifier = Modifier.clickable {
                            forwarding = null
                            repo.forward(m, c.id)
                        },
                    )
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun SheetItem(text: String, icon: androidx.compose.ui.graphics.vector.ImageVector, danger: Boolean = false, onClick: () -> Unit) {
    val color = if (danger) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface
    ListItem(
        headlineContent = { Text(text, color = color) },
        leadingContent = { Icon(icon, null, tint = color) },
        modifier = Modifier.clickable(onClick = onClick),
    )
}

@Composable
private fun DateChip(t: Long) {
    Box(Modifier.fillMaxWidth().padding(vertical = 8.dp), contentAlignment = Alignment.Center) {
        Surface(shape = RoundedCornerShape(50), color = MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.9f)) {
            Text(formatDay(t), style = MaterialTheme.typography.labelMedium, modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp))
        }
    }
}

@Composable
private fun EmptyChat(saved: Boolean, channel: Boolean = false) {
    Box(Modifier.fillMaxWidth().padding(32.dp), contentAlignment = Alignment.Center) {
        Surface(shape = RoundedCornerShape(24.dp), color = MaterialTheme.colorScheme.surfaceContainerHigh.copy(alpha = 0.9f)) {
            Column(Modifier.padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(if (saved) "🔖" else if (channel) "📣" else "👋", fontSize = 56.sp)
                Spacer(Modifier.height(8.dp))
                Text(if (saved) "Избранное" else if (channel) "В канале пока нет постов" else "Пока тихо", style = MaterialTheme.typography.titleMedium)
                Spacer(Modifier.height(4.dp))
                Text(
                    when {
                        saved -> "Пересылайте сюда сообщения, фото и файлы, чтобы не потерять."
                        channel -> "Здесь появятся посты, голосовые и квадратики владельца канала."
                        else -> "Напишите первым! Сообщения защищены сквозным шифрованием."
                    },
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
    }
}

private fun copy(context: Context, text: String) {
    val cm = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
    cm.setPrimaryClip(ClipData.newPlainText("message", text))
}

@Composable
private fun ChannelBar(subscribed: Boolean, joinText: String, muted: Boolean, onSubscribe: () -> Unit, onToggleMute: () -> Unit) {
    Surface(color = MaterialTheme.colorScheme.surfaceContainer) {
        Box(Modifier.fillMaxWidth().navigationBarsPadding().padding(horizontal = 16.dp, vertical = 8.dp), contentAlignment = Alignment.Center) {
            AnimatedContent(subscribed, label = "sub", transitionSpec = { (scaleIn(spring(Spring.DampingRatioMediumBouncy)) + fadeIn()) togetherWith fadeOut() }) { sub ->
                if (!sub) {
                    Button(onClick = onSubscribe, modifier = Modifier.fillMaxWidth().height(48.dp)) {
                        Icon(Icons.Default.Add, null)
                        Spacer(Modifier.width(8.dp))
                        Text(joinText)
                    }
                } else {
                    TextButton(onClick = onToggleMute, modifier = Modifier.fillMaxWidth().height(48.dp)) {
                        Icon(if (muted) Icons.Default.Notifications else Icons.Default.NotificationsOff, null)
                        Spacer(Modifier.width(8.dp))
                        Text(if (muted) "Включить звук" else "Выключить звук")
                    }
                }
            }
        }
    }
}

@Composable
private fun VoiceRecordingBar(elapsed: Long, dragX: Float, cancelDistance: Float, modifier: Modifier) {
    val t = rememberInfiniteTransition(label = "hint")
    val nudge by t.animateFloat(0f, -10f, infiniteRepeatable(tween(700), RepeatMode.Reverse), label = "nudge")
    val cancelP = (-dragX / cancelDistance).coerceIn(0f, 1f)
    Row(modifier.padding(start = 12.dp), verticalAlignment = Alignment.CenterVertically) {
        RecordingDot()
        Spacer(Modifier.width(8.dp))
        Text(formatDuration(elapsed), style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.weight(1f))
        Text(
            "‹ Влево — отмена",
            color = if (cancelP > 0.6f) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurfaceVariant,
            modifier = Modifier.graphicsLayer {
                translationX = dragX * 0.6f + nudge * density
                alpha = 1f - cancelP * 0.5f
            },
        )
        Spacer(Modifier.width(12.dp))
    }
}

/**
 * Кнопка записи: нажатие переключает «голосовое» ↔ «квадратик»,
 * удержание записывает, отпускание отправляет, свайп влево отменяет.
 */
@Composable
private fun RecordButton(
    mode: String,
    recording: Boolean,
    level: Float,
    onTap: () -> Unit,
    onStart: () -> Boolean,
    onDrag: (Float) -> Unit,
    onEnd: (cancel: Boolean) -> Unit,
    cancelDistance: Float,
) {
    val tap by rememberUpdatedState(onTap)
    val start by rememberUpdatedState(onStart)
    val drag by rememberUpdatedState(onDrag)
    val end by rememberUpdatedState(onEnd)
    val haptic = LocalHapticFeedback.current
    val scale by animateFloatAsState(if (recording) 1.5f else 1f, spring(Spring.DampingRatioMediumBouncy), label = "rec")
    val pulse by animateFloatAsState(if (recording) 1f + level * 0.6f else 1f, label = "pulse")
    Box(contentAlignment = Alignment.Center, modifier = Modifier.size(52.dp)) {
        if (recording) {
            Box(
                Modifier
                    .size(52.dp)
                    .graphicsLayer { scaleX = scale * pulse; scaleY = scale * pulse }
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primary.copy(alpha = 0.25f)),
            )
        }
        Box(
            Modifier
                .size(52.dp)
                .graphicsLayer { scaleX = scale; scaleY = scale }
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.primary)
                .pointerInput(Unit) {
                    awaitEachGesture {
                        val down = awaitFirstDown()
                        var released = false
                        withTimeoutOrNull(250) {
                            waitForUpOrCancellation()
                            released = true
                        }
                        if (released) { tap(); return@awaitEachGesture }
                        if (!start()) { waitForUpOrCancellation(); return@awaitEachGesture }
                        haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                        var cancelled = false
                        while (true) {
                            val ev = awaitPointerEvent()
                            val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                            if (!ch.pressed) break
                            val dx = (ch.position.x - down.position.x).coerceAtMost(0f)
                            drag(dx)
                            ch.consume()
                            if (dx < -cancelDistance) { cancelled = true; break }
                        }
                        end(cancelled)
                        if (cancelled) {
                            haptic.performHapticFeedback(HapticFeedbackType.LongPress)
                            waitForUpOrCancellation()
                        }
                    }
                },
            contentAlignment = Alignment.Center,
        ) {
            AnimatedContent(
                mode,
                label = "mode",
                transitionSpec = { (scaleIn(spring(Spring.DampingRatioMediumBouncy)) + fadeIn()) togetherWith (scaleOut() + fadeOut()) },
            ) { m ->
                Icon(
                    if (m == "voice") Icons.Default.Mic else Icons.Default.CropSquare,
                    if (m == "voice") "Голосовое" else "Квадратик",
                    tint = MaterialTheme.colorScheme.onPrimary,
                )
            }
        }
    }
}
