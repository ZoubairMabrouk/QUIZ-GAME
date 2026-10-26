import 'dart:async';

import 'package:flutter/foundation.dart' show kIsWeb;
import 'package:flutter/semantics.dart';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';

import 'api.dart';
import 'game_controller.dart';
import 'competitions_page.dart';
import 'player_account_page.dart';
import 'play_setup_page.dart';
import 'room_share_page.dart';
import 'question_media.dart';

SemanticsHandle? webSemantics;

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  if (kIsWeb) webSemantics = SemanticsBinding.instance.ensureSemantics();
  const url = String.fromEnvironment(
    'API_URL',
    defaultValue: 'http://localhost:3000',
  );
  final controller=GameController(QuizApi(url));
  final destination=Uri.base.fragment.isEmpty?Uri.base.path:Uri.base.fragment;
  controller.pendingRoomCode=RegExp(r'^/join/([A-Z2-9]{6})$').firstMatch(destination)?.group(1);
  runApp(QuizApp(controller: controller));
}

const ink = Color(0xFF18233E),
    purple = Color(0xFF6554DF),
    muted = Color(0xFF69758B),
    canvas = Color(0xFFF4F6FB);

class QuizApp extends StatelessWidget {
  final GameController controller;
  const QuizApp({super.key, required this.controller});
  @override
  Widget build(BuildContext context) => MaterialApp(
        initialRoute:'/',
        title: 'Quiz • Entre amis',
        debugShowCheckedModeBanner: false,
        theme: ThemeData(
          useMaterial3: true,
          colorScheme: ColorScheme.fromSeed(seedColor: purple),
          scaffoldBackgroundColor: canvas,
          textTheme: const TextTheme(
            headlineLarge: TextStyle(
              fontSize: 38,
              fontWeight: FontWeight.w800,
              color: ink,
              height: 1.15,
            ),
            headlineMedium: TextStyle(
              fontSize: 28,
              fontWeight: FontWeight.w800,
              color: ink,
            ),
            titleLarge: TextStyle(
              fontSize: 21,
              fontWeight: FontWeight.w700,
              color: ink,
            ),
            bodyLarge: TextStyle(fontSize: 16, color: ink),
            bodyMedium: TextStyle(color: ink),
          ),
          inputDecorationTheme: InputDecorationTheme(
            filled: true,
            fillColor: const Color(0xFFF6F7FC),
            contentPadding: const EdgeInsets.all(18),
            border: OutlineInputBorder(
              borderRadius: BorderRadius.circular(14),
              borderSide: const BorderSide(color: Color(0xFFDDE2EF)),
            ),
          ),
          filledButtonTheme: FilledButtonThemeData(
            style: FilledButton.styleFrom(
              minimumSize: const Size(0, 52),
              padding: const EdgeInsets.symmetric(horizontal: 24),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
            ),
          ),
          outlinedButtonTheme: OutlinedButtonThemeData(
            style: OutlinedButton.styleFrom(
              minimumSize: const Size(0, 48),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
            ),
          ),
        ),
        home: QuizHome(controller: controller),
      );
}

class QuizHome extends StatefulWidget {
  final GameController controller;
  const QuizHome({super.key, required this.controller});
  @override
  State<QuizHome> createState() => _QuizHomeState();
}

class _QuizHomeState extends State<QuizHome> with WidgetsBindingObserver {
  GameController get g => widget.controller;
  final phone = TextEditingController(),
      otp = TextEditingController(),
      pseudo = TextEditingController(),
      code = TextEditingController();
  bool consent = false;
  String channel = 'sms';
  int count = 3, duration = 10;
  String? profileId;
  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    unawaited(g.initialize());
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && g.roomCode != null) {
      unawaited(g.connect());
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    for (final c in [phone, otp, pseudo, code]) {
      c.dispose();
    }
    g.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => AnimatedBuilder(
        animation: g,
        builder: (context, _) {
          if (!g.channels.contains(channel) && g.channels.isNotEmpty) {
            channel = g.channels.first;
          }
          if (g.user != null && profileId != g.user!['id']) {
            profileId = g.user!['id'] as String;
            pseudo.text = (g.user!['pseudo'] as String).startsWith('Player_')
                ? ''
                : g.user!['pseudo'] as String;
          }
          return Scaffold(
            body: SafeArea(
              child: Column(
                children: [
                  _header(),
                  if (g.busy) const LinearProgressIndicator(minHeight: 2),
                  Expanded(
                    child: SingleChildScrollView(
                      padding: EdgeInsets.symmetric(
                        horizontal:
                            MediaQuery.sizeOf(context).width < 600 ? 18 : 36,
                        vertical: 24,
                      ),
                      child: Center(
                        child: ConstrainedBox(
                          constraints: const BoxConstraints(maxWidth: 1120),
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.stretch,
                            children: [
                              if (g.mock)
                                Padding(
                                  padding: const EdgeInsets.only(bottom: 20),
                                  child: _notice(
                                    Icons.science_outlined,
                                    'Mode test · aucun SMS envoyé. Joueurs : +12025550123 et +12025550124. Code : 000000.',
                                    color: const Color(0xFFFFF3D7),
                                  ),
                                ),
                              if (g.error != null)
                                Padding(
                                  padding: const EdgeInsets.only(bottom: 20),
                                  child: Material(
                                    color: const Color(0xFFFFE8E7),
                                    borderRadius: BorderRadius.circular(14),
                                    child: Padding(
                                      padding: const EdgeInsets.fromLTRB(
                                        16,
                                        8,
                                        8,
                                        8,
                                      ),
                                      child: Row(
                                        children: [
                                          const Icon(
                                            Icons.info_outline,
                                            color: Colors.redAccent,
                                          ),
                                          const SizedBox(width: 12),
                                          Expanded(
                                            child: Text(
                                              g.error!,
                                              key: const Key('error-banner'),
                                            ),
                                          ),
                                          IconButton(
                                            onPressed: g.dismissError,
                                            tooltip: 'Fermer le message',
                                            icon: const Icon(Icons.close),
                                          ),
                                        ],
                                      ),
                                    ),
                                  ),
                                ),
                              if (g.user == null)
                                _login()
                              else if (g.room == null)
                                _home()
                              else
                                _room(),
                              const SizedBox(height: 30),
                              const Text(
                                'QUIZ  /  Jouez ensemble. Progressez ensemble.',
                                textAlign: TextAlign.center,
                                style: TextStyle(
                                  fontSize: 12,
                                  color: muted,
                                  letterSpacing: 1,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ),
                    ),
                  ),
                ],
              ),
            ),
          );
        },
      );
  Widget _header() => Container(
        color: Colors.white,
        padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 12),
        child: Row(
          children: [
            Container(
              padding: const EdgeInsets.all(8),
              decoration: BoxDecoration(
                color: purple,
                borderRadius: BorderRadius.circular(12),
              ),
              child: const Icon(Icons.bolt, color: Colors.white),
            ),
            const SizedBox(width: 10),
            const Text(
              'QUIZ',
              style: TextStyle(
                fontSize: 24,
                fontWeight: FontWeight.w900,
                letterSpacing: 2,
                color: ink,
              ),
            ),
            const Spacer(),
            if (g.user != null) ...[
              if (MediaQuery.sizeOf(context).width > 600)
                Padding(
                  padding: const EdgeInsets.only(right: 18),
                  child: Text(
                    g.user!['pseudo'] as String,
                    style: const TextStyle(fontWeight: FontWeight.w600),
                  ),
                ),
              if (g.room != null)
                IconButton(
                  onPressed: g.busy ? null : g.home,
                  tooltip: 'Retour à l’accueil',
                  icon: const Icon(Icons.home_outlined),
                ),
              IconButton(
                onPressed: g.busy ? null : () => g.logout(),
                tooltip: 'Se déconnecter',
                icon: const Icon(Icons.logout),
              ),
            ] else
              const Text(
                'ENTRE AMIS',
                style:
                    TextStyle(color: muted, fontSize: 12, letterSpacing: 1.6),
              ),
          ],
        ),
      );
  Widget _panel(Widget child, {Color color = Colors.white}) => Material(
        color: color,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(24),
          side: const BorderSide(color: Color(0xFFE5E9F2)),
        ),
        child: Padding(padding: const EdgeInsets.all(26), child: child),
      );
  Widget _notice(
    IconData icon,
    String text, {
    Color color = const Color(0xFFEFEDFF),
  }) =>
      Container(
        padding: const EdgeInsets.all(16),
        decoration: BoxDecoration(
          color: color,
          borderRadius: BorderRadius.circular(14),
        ),
        child: Row(
          children: [
            Icon(icon, size: 22),
            const SizedBox(width: 12),
            Expanded(child: Text(text, style: const TextStyle(height: 1.5))),
          ],
        ),
      );
  Widget _title(String eyebrow, String title, [String? subtitle]) => Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            eyebrow,
            style: const TextStyle(
              fontSize: 11,
              fontWeight: FontWeight.w800,
              letterSpacing: 2,
              color: purple,
            ),
          ),
          const SizedBox(height: 10),
          Text(title, style: Theme.of(context).textTheme.headlineMedium),
          if (subtitle != null) ...[
            const SizedBox(height: 10),
            Text(subtitle, style: const TextStyle(color: muted, height: 1.5)),
          ],
          const SizedBox(height: 24),
        ],
      );
  Widget _two(Widget left, Widget right, {int flex = 1}) => LayoutBuilder(
        builder: (context, box) => box.maxWidth > 780
            ? Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Expanded(flex: flex, child: left),
                  const SizedBox(width: 24),
                  Expanded(child: right),
                ],
              )
            : Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [left, const SizedBox(height: 20), right],
              ),
      );
  Widget _login() {
    final form = _panel(
      Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _title(
            'BIENVENUE',
            g.challengeId == null
                ? 'Votre prochain défi\ncommence ici.'
                : 'Un code, et c’est parti.',
            g.challengeId == null
                ? 'Connectez-vous avec votre numéro de téléphone.'
                : 'Saisissez le code envoyé à ${phone.text}.',
          ),
          if (g.configuration == null) ...[
            const Text('Connexion au serveur…'),
            const SizedBox(height: 12),
            OutlinedButton(
              onPressed: g.busy ? null : g.initialize,
              child: const Text('Réessayer'),
            ),
          ] else if (g.challengeId == null) ...[
            TextField(
              key: const Key('phone-input'),
              controller: phone,
              keyboardType: TextInputType.phone,
              autofillHints: const [AutofillHints.telephoneNumber],
              decoration: const InputDecoration(
                labelText: 'Numéro international',
                hintText: '+33 6…',
                prefixIcon: Icon(Icons.phone_outlined),
              ),
            ),
            if (g.mock)
              Wrap(
                spacing: 8,
                children: [
                  TextButton(
                    onPressed: () => phone.text = '+12025550123',
                    child: const Text('Joueur 1'),
                  ),
                  TextButton(
                    onPressed: () => phone.text = '+12025550124',
                    child: const Text('Joueur 2'),
                  ),
                ],
              ),
            const SizedBox(height: 16),
            Wrap(
              spacing: 10,
              children: g.channels
                  .map(
                    (c) => ChoiceChip(
                      label: Text(c == 'sms' ? 'SMS' : 'WhatsApp'),
                      selected: channel == c,
                      onSelected: (_) => setState(() => channel = c),
                    ),
                  )
                  .toList(),
            ),
            const SizedBox(height: 12),
            CheckboxListTile(
              contentPadding: EdgeInsets.zero,
              controlAffinity: ListTileControlAffinity.leading,
              value: consent,
              onChanged: (v) => setState(() => consent = v ?? false),
              title: const Text(
                'J’accepte de recevoir un code pour me connecter.',
                style: TextStyle(fontSize: 13),
              ),
            ),
            const SizedBox(height: 12),
            FilledButton(
              key: const Key('request-otp'),
              onPressed: g.busy || !consent
                  ? null
                  : () => g.requestCode(
                        phone.text.replaceAll(' ', ''),
                        g.channels.contains(channel)
                            ? channel
                            : g.channels.first,
                        consent,
                      ),
              child: const Text('Recevoir mon code'),
            ),
          ] else ...[
            TextField(
              key: const Key('otp-input'),
              controller: otp,
              keyboardType: TextInputType.number,
              maxLength: 10,
              autofillHints: const [AutofillHints.oneTimeCode],
              inputFormatters: [FilteringTextInputFormatter.digitsOnly],
              decoration: const InputDecoration(
                labelText: 'Code de vérification',
                counterText: '',
                prefixIcon: Icon(Icons.lock_outline),
              ),
              onSubmitted: (_) {
                if (!g.busy) g.verify(otp.text);
              },
            ),
            const SizedBox(height: 20),
            FilledButton(
              key: const Key('verify-otp'),
              onPressed: g.busy ? null : () => g.verify(otp.text),
              child: const Text('Entrer dans le jeu'),
            ),
            const SizedBox(height: 10),
            TextButton(
              onPressed: g.busy || g.resendSeconds > 0
                  ? null
                  : () => g.requestCode(
                        phone.text.replaceAll(' ', ''),
                        channel,
                        consent,
                      ),
              child: Text(
                g.resendSeconds > 0
                    ? 'Renvoyer dans ${g.resendSeconds} s'
                    : 'Renvoyer un code',
              ),
            ),
            TextButton(
              onPressed: g.busy ? null : g.changePhone,
              child: const Text('Modifier le numéro ou le canal'),
            ),
          ],
        ],
      ),
    );
    final intro = Container(
      padding: const EdgeInsets.all(32),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF19243F), Color(0xFF3D327C)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(24),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.auto_awesome, size: 36, color: Color(0xFFFAC778)),
          const SizedBox(height: 38),
          const Text(
            'Un code de salle.\nDes amis.\nÀ vous de jouer.',
            style: TextStyle(
              fontSize: 38,
              height: 1.15,
              color: Colors.white,
              fontWeight: FontWeight.w800,
            ),
          ),
          const SizedBox(height: 22),
          const Text(
            'Culture, science, géographie…\nPartagez le défi, une question à la fois.',
            style: TextStyle(
              fontSize: 17,
              height: 1.7,
              color: Color(0xFFD2D8ED),
            ),
          ),
          const SizedBox(height: 38),
          for (final (icon, text) in [
            (Icons.people_outline, 'Invitez un ami avec 6 caractères'),
            (Icons.timer_outlined, 'Répondez avant la fin du chrono'),
            (Icons.emoji_events_outlined, 'Découvrez votre classement'),
          ])
            Padding(
              padding: const EdgeInsets.only(bottom: 20),
              child: Row(
                children: [
                  Icon(icon, color: const Color(0xFFFAC778)),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Text(
                      text,
                      style: const TextStyle(color: Colors.white, fontSize: 14),
                    ),
                  ),
                ],
              ),
            ),
        ],
      ),
    );
    return _two(intro, form);
  }

  Future<void> _setupGame() async {
    final state=await Navigator.of(context).push<Map<String,dynamic>>(MaterialPageRoute(builder:(_)=>PlaySetupPage(api:g.api)));
    if(state!=null && mounted)g.enterRoom(state);
  }
  Future<void> _account() async {
    final result=await Navigator.of(context).push<Map<String,dynamic>>(MaterialPageRoute(builder:(_)=>PlayerAccountPage(api:g.api,userId:g.user!['id'] as String)));
    if(!mounted)return;
    if(result?['deleted']==true){g.clearDeletedAccount();return;}
    if(result?['join']!=null)await g.joinRoom(result!['join'] as String);
    await g.run(()async{g.user=await g.api.call('/me');g.wallet=await g.api.call('/wallet');});
  }
  Widget _home() => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(spacing:12,children:[FilledButton.icon(onPressed:_setupGame,icon:const Icon(Icons.play_arrow),label:const Text('Solo, duel ou salle')),OutlinedButton.icon(onPressed:_account,icon:const Icon(Icons.person_outline),label:const Text('Profil, amis et portefeuille'))]),
          OutlinedButton.icon(
            onPressed: () => Navigator.of(context).push(MaterialPageRoute<void>(builder: (_) => CompetitionsPage(api: g.api))),
            icon: const Icon(Icons.emoji_events_outlined),
            label: const Text('Compétitions'),
          ),
          _title(
            'VOTRE ESPACE',
            'On lance une partie ?',
            'Créez votre salle ou rejoignez celle d’un ami.',
          ),
          Wrap(
            spacing: 12,
            runSpacing: 12,
            children: [
              _stat(Icons.toll, '${g.wallet?['silver'] ?? 0}', 'Silver Tokens'),
              _stat(
                Icons.stars_outlined,
                '${g.wallet?['golden'] ?? 0}',
                'Golden Tokens',
              ),
            ],
          ),
          const SizedBox(height: 24),
          _panel(
            Column(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                const Text(
                  'Comment vos amis vous reconnaissent-ils ?',
                  style: TextStyle(fontWeight: FontWeight.w700),
                ),
                const SizedBox(height: 14),
                Wrap(
                  spacing: 12,
                  runSpacing: 12,
                  crossAxisAlignment: WrapCrossAlignment.center,
                  children: [
                    SizedBox(
                      width: 280,
                      child: TextField(
                        key: const Key('pseudo-input'),
                        controller: pseudo,
                        maxLength: 24,
                        decoration: const InputDecoration(
                          labelText: 'Votre pseudo',
                          counterText: '',
                        ),
                      ),
                    ),
                    OutlinedButton(
                      onPressed:
                          g.busy ? null : () => g.saveProfile(pseudo.text),
                      child: const Text('Enregistrer le pseudo'),
                    ),
                  ],
                ),
              ],
            ),
          ),
          const SizedBox(height: 24),
          _two(
            _panel(
              Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _title(
                    '01 / CRÉER',
                    'Votre salle, vos règles.',
                    'Questions variées · 2 à 8 joueurs',
                  ),
                  DropdownButtonFormField<int>(
                    value: count,
                    decoration: const InputDecoration(
                      labelText: 'Nombre de questions',
                    ),
                    items: [1, 2, 3, 4, 5]
                        .map(
                          (n) => DropdownMenuItem(
                            value: n,
                            child: Text('$n questions'),
                          ),
                        )
                        .toList(),
                    onChanged: (v) => setState(() => count = v!),
                  ),
                  const SizedBox(height: 16),
                  DropdownButtonFormField<int>(
                    value: duration,
                    decoration: const InputDecoration(
                      labelText: 'Temps par question',
                    ),
                    items: [10, 15, 20, 30]
                        .map(
                          (n) => DropdownMenuItem(
                            value: n,
                            child: Text('$n secondes'),
                          ),
                        )
                        .toList(),
                    onChanged: (v) => setState(() => duration = v!),
                  ),
                  const SizedBox(height: 24),
                  FilledButton.icon(
                    key: const Key('create-room'),
                    onPressed:
                        g.busy ? null : _setupGame,
                    icon: const Icon(Icons.add),
                    label: const Text('Créer une salle'),
                  ),
                ],
              ),
            ),
            _panel(
              Column(
                crossAxisAlignment: CrossAxisAlignment.stretch,
                children: [
                  _title(
                    '02 / REJOINDRE',
                    'Votre place vous attend.',
                    'Demandez le code de salle à votre ami.',
                  ),
                  TextField(
                    key: const Key('room-code-input'),
                    controller: code,
                    maxLength: 6,
                    textCapitalization: TextCapitalization.characters,
                    style: const TextStyle(
                      letterSpacing: 6,
                      fontWeight: FontWeight.w800,
                      fontSize: 22,
                    ),
                    decoration: const InputDecoration(
                      labelText: 'Code de salle',
                      hintText: 'ABC234',
                      counterText: '',
                    ),
                    onSubmitted: (_) {
                      if (!g.busy) g.joinRoom(code.text);
                    },
                  ),
                  const SizedBox(height: 24),
                  OutlinedButton.icon(
                    key: const Key('join-room'),
                    onPressed: g.busy ? null : () => g.joinRoom(code.text),
                    icon: const Icon(Icons.login),
                    label: const Text('Rejoindre la partie'),
                  ),
                  const SizedBox(height: 24),
                  const Text(
                    'Vous pouvez retrouver une partie en cours avec le même compte et son code.',
                    style: TextStyle(color: muted, height: 1.5),
                  ),
                ],
              ),
            ),
          ),
        ],
      );
  Widget _stat(IconData icon, String number, String label) => Container(
        width: 200,
        padding: const EdgeInsets.all(18),
        decoration: BoxDecoration(
          color: Colors.white,
          borderRadius: BorderRadius.circular(18),
        ),
        child: Row(
          children: [
            Icon(icon, color: purple),
            const SizedBox(width: 12),
            Expanded(
                child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  number,
                  style: const TextStyle(
                      fontSize: 24, fontWeight: FontWeight.w800),
                ),
                Text(label, style: const TextStyle(fontSize: 12, color: muted)),
              ],
            )),
          ],
        ),
      );
  Widget _room() => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Wrap(
            alignment: WrapAlignment.spaceBetween,
            spacing: 16,
            runSpacing: 12,
            crossAxisAlignment: WrapCrossAlignment.center,
            children: [
              Row(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Icon(Icons.meeting_room_outlined, color: purple),
                  const SizedBox(width: 10),
                  SelectableText(
                    g.roomCode!,
                    key: const Key('room-code'),
                    style: const TextStyle(
                      fontSize: 24,
                      letterSpacing: 4,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                  IconButton(
                    tooltip: 'Copier le code',
                    onPressed: () {
                      Clipboard.setData(ClipboardData(text: g.roomCode!));
                      ScaffoldMessenger.of(context).showSnackBar(
                        const SnackBar(
                          content: Text('Code copié. Envoyez-le à votre ami.'),
                        ),
                      );
                    },
                    icon: const Icon(Icons.copy, size: 18),
                  ),
                ],
              ),
              Chip(
                avatar: Icon(
                  g.live ? Icons.wifi : Icons.wifi_off,
                  size: 17,
                  color: g.live ? const Color(0xFF168A68) : Colors.orange,
                ),
                label: Text(g.live ? 'En direct' : 'Reconnexion…'),
              ),
            ],
          ),
          const SizedBox(height: 20),
          if (!g.live)
            Padding(
              padding: const EdgeInsets.only(bottom: 18),
              child: _notice(
                Icons.sync,
                'La connexion est interrompue. Votre partie continue ; nous récupérons son état automatiquement.',
              ),
            ),
          if (g.status == 'lobby')
            _lobby()
          else if (g.status == 'finished')
            _finished()
          else
            _question(),
        ],
      );
  Widget _lobby() => _two(
        _panel(
          Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              _title(
                'AVANT LE DÉPART',
                'Tout le monde est prêt ?',
                'Partagez le code ci-dessus. Chaque joueur doit confirmer qu’il est prêt.',
              ),
              _notice(
                Icons.tune,
                '${g.room!['questionCount']} questions  ·  ${(g.room!['durationMs'] as int) ~/ 1000} secondes par question',
              ),
              const SizedBox(height: 24),
              FilledButton.icon(
                key: const Key('ready-button'),
                onPressed: g.busy || !g.live
                    ? null
                    : () => g.command('ready', {'ready': !g.myReady}),
                icon: Icon(
                  g.myReady ? Icons.check_circle : Icons.front_hand_outlined,
                ),
                label: Text(
                  g.myReady ? 'Prêt ! Modifier mon statut' : 'Je suis prêt',
                ),
              ),
              const SizedBox(height: 14),
              if (g.isHost)
                OutlinedButton.icon(
                  key: const Key('start-button'),
                  onPressed: g.busy || !g.live || !g.canStart
                      ? null
                      : () => g.command('start'),
                  icon: const Icon(Icons.play_arrow),
                  label: const Text('Lancer la partie'),
                )
              else
                const Text(
                  'L’hôte lancera la partie quand tout le monde sera prêt.',
                  style: TextStyle(color: muted, height: 1.5),
                ),
              if (g.players.length < 2)
                const Padding(
                  padding: EdgeInsets.only(top: 18),
                  child: Text(
                    'Il manque un joueur pour commencer.',
                    style: TextStyle(color: muted),
                  ),
                ),
            ],
          ),
        ),
        _panel(_players()),
        flex: 2,
      );
  Widget _players() => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          Text(g.room?['name'] as String? ?? 'Salle'),
          TextButton.icon(onPressed:()=>Navigator.of(context).push(MaterialPageRoute<void>(builder:(_)=>RoomSharePage(api:g.api,code:g.roomCode!))),icon:const Icon(Icons.qr_code),label:const Text('Lien et QR')),
          _title('DANS LA SALLE', '${g.players.length} joueurs'),
          for (final p in g.players)
            Padding(
              padding: const EdgeInsets.only(bottom: 18),
              child: Row(
                children: [
                  CircleAvatar(
                    backgroundColor: const Color(0xFFEFEDFF),
                    child: Text(
                      (p['pseudo'] as String).substring(0, 1).toUpperCase(),
                    ),
                  ),
                  const SizedBox(width: 12),
                  Expanded(
                    child: Text(
                      '${p['pseudo']}${p['id'] == g.user!['id'] ? ' (vous)' : ''}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ),
                  const SizedBox(width: 6),
                  if(g.isHost && p['id']!=g.user?['id'] && g.status=='lobby')PopupMenuButton<String>(tooltip:'Gerer le joueur',onSelected:(action)=>g.command(action,{'userId':p['id']}),itemBuilder:(_)=>const [PopupMenuItem(value:'host',child:Text('Transferer le role hote')),PopupMenuItem(value:'kick',child:Text('Expulser'))]),
                  Icon(
                    p['ready'] == true ? Icons.check_circle : Icons.more_horiz,
                    color: p['ready'] == true ? const Color(0xFF168A68) : muted,
                  ),
                ],
              ),
            ),
        ],
      );
  Widget _question() {
    final q = g.room!['question'] as Map<String, dynamic>;
    final choices = (q['choices'] as List).cast<String>();
    final result = g.status == 'results';
    final selected = g.room!['selectedChoice'] as int?,
        correct = g.room!['correctIndex'] as int?;
    return _two(
      _panel(
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                Expanded(
                  child: _title(
                    'QUESTION ${g.room!['questionNumber']} / ${g.room!['questionCount']}',
                    result ? 'La réponse est…' : 'À vous de jouer.',
                  ),
                ),
                SizedBox(
                  width: 72,
                  height: 72,
                  child: Stack(
                    alignment: Alignment.center,
                    children: [
                      SizedBox.expand(
                        child: CircularProgressIndicator(
                          value: result
                              ? 0
                              : (g.secondsLeft /
                                      ((g.room!['durationMs'] as int) / 1000))
                                  .clamp(0, 1),
                          strokeWidth: 5,
                          backgroundColor: const Color(0xFFEFEDFF),
                          color: g.secondsLeft <= 3 ? Colors.orange : purple,
                        ),
                      ),
                      Text(
                        result ? '✓' : '${g.secondsLeft}',
                        semanticsLabel: result
                            ? 'Question terminée'
                            : '${g.secondsLeft} secondes restantes',
                        style: const TextStyle(
                          fontSize: 28,
                          fontWeight: FontWeight.w800,
                        ),
                      ),
                    ],
                  ),
                ),
              ],
            ),
            const SizedBox(height: 18),
            Text(
              q['text'] as String,
              key: const Key('question-text'),
              style: const TextStyle(
                fontSize: 25,
                fontWeight: FontWeight.w700,
                height: 1.35,
              ),
            ),
            const SizedBox(height: 28),
            QuestionMedia(media:q['media']),
            for (var i = 0; i < choices.length; i++)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Semantics(
                  selected: selected == i,
                  child: OutlinedButton(
                    key: Key('choice-$i'),
                    onPressed: result ||
                            g.answered ||
                            g.busy ||
                            !g.live ||
                            g.secondsLeft <= 0
                        ? null
                        : () => g.answer(i),
                    style: OutlinedButton.styleFrom(
                      padding: const EdgeInsets.all(18),
                      alignment: Alignment.centerLeft,
                      disabledForegroundColor: ink,
                      side: BorderSide(
                        color: result && correct == i
                            ? const Color(0xFF168A68)
                            : selected == i
                                ? purple
                                : const Color(0xFFDDE2EF),
                        width:
                            selected == i || (result && correct == i) ? 2 : 1,
                      ),
                      backgroundColor: result && correct == i
                          ? const Color(0xFFE3F5ED)
                          : selected == i
                              ? const Color(0xFFEFEDFF)
                              : Colors.white,
                    ),
                    child: Row(
                      children: [
                        Text(
                          String.fromCharCode(65 + i),
                          style: const TextStyle(
                            fontWeight: FontWeight.w800,
                            color: purple,
                          ),
                        ),
                        const SizedBox(width: 18),
                        Expanded(
                          child: Text(
                            choices[i],
                            style: const TextStyle(fontSize: 16),
                          ),
                        ),
                        if (result && correct == i)
                          const Icon(
                            Icons.check_circle,
                            color: Color(0xFF168A68),
                          )
                        else if (selected == i)
                          const Icon(Icons.check, color: purple),
                      ],
                    ),
                  ),
                ),
              ),
            const SizedBox(height: 10),
            if (result) ...[
              _notice(
                Icons.lightbulb_outline,
                g.room!['explanation'] as String,
              ),
              const SizedBox(height: 18),
              if (g.isHost)
                FilledButton(
                  key: const Key('next-button'),
                  onPressed: g.busy || !g.live ? null : () => g.command('next'),
                  child: const Text('Question suivante'),
                )
              else
                const Text(
                  'En attente de la prochaine question…',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: muted),
                ),
            ] else if (g.answered)
              _notice(
                Icons.check_circle_outline,
                'Réponse enregistrée. Les résultats arrivent à la fin du chrono.',
              )
            else if (g.secondsLeft == 0)
              const Text(
                'Calcul des résultats…',
                textAlign: TextAlign.center,
                style: TextStyle(color: muted),
              ),
          ],
        ),
      ),
      _panel(_ranking()),
      flex: 2,
    );
  }

  Widget _ranking() => Column(
        crossAxisAlignment: CrossAxisAlignment.stretch,
        children: [
          _title('LES SCORES', 'Classement'),
          for (final p
              in (g.room!['ranking'] as List).cast<Map<String, dynamic>>())
            Padding(
              padding: const EdgeInsets.only(bottom: 20),
              child: Row(
                children: [
                  Text(
                    '${p['rank']}'.padLeft(2, '0'),
                    style: const TextStyle(
                      fontSize: 18,
                      color: muted,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                  const SizedBox(width: 14),
                  Expanded(
                    child: Text(
                      '${p['pseudo']}${p['id'] == g.user!['id'] ? ' · vous' : ''}',
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                      style: const TextStyle(fontWeight: FontWeight.w600),
                    ),
                  ),
                  const SizedBox(width: 8),
                  Text(
                    '${p['score']}',
                    style: const TextStyle(
                      color: purple,
                      fontWeight: FontWeight.w800,
                      fontSize: 18,
                    ),
                  ),
                ],
              ),
            ),
          const Text(
            'Les scores sont révélés à la fin de chaque question.',
            style: TextStyle(fontSize: 12, color: muted, height: 1.5),
          ),
        ],
      );
  Widget _finished() {
    final ranking = (g.room!['ranking'] as List).cast<Map<String, dynamic>>();
    final winner = ranking.first;
    final reward = (g.room!['rewards'] as List)
        .cast<Map<String, dynamic>>()
        .where((p) => p['userId'] == g.user!['id'])
        .firstOrNull;
    return _two(
      _panel(
        Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            const Icon(
              Icons.emoji_events_rounded,
              size: 72,
              color: Color(0xFFE4AA40),
            ),
            const SizedBox(height: 20),
            Text(
              'Bien joué !',
              key: const Key('finished-title'),
              textAlign: TextAlign.center,
              style: Theme.of(context).textTheme.headlineLarge,
            ),
            const SizedBox(height: 12),
            Text(
              '${winner['pseudo']} remporte cette partie.',
              textAlign: TextAlign.center,
              style: const TextStyle(fontSize: 18, color: muted),
            ),
            const SizedBox(height: 28),
            _notice(
              Icons.toll,
              reward?['reason'] == 'daily_cap'
                  ? 'Plafond quotidien atteint : aucun Silver supplémentaire.'
                  : '+${reward?['amount'] ?? 0} Silver Tokens dans votre portefeuille.',
            ),
            const SizedBox(height: 24),
            if (g.room!['question'] != null) ...[
              Text(
                'Dernière question : ${g.room!['question']['text']}',
                style: const TextStyle(fontWeight: FontWeight.w700),
              ),
              const SizedBox(height: 8),
              Text(
                g.room!['explanation'] as String,
                style: const TextStyle(color: muted, height: 1.5),
              ),
              const SizedBox(height: 24),
            ],
            if(g.isHost)OutlinedButton(onPressed:g.busy?null:g.rematch,child:const Text('Revanche')),
            FilledButton(
              onPressed: g.home,
              child: const Text('Retour à l’accueil'),
            ),
          ],
        ),
      ),
      _panel(_ranking()),
      flex: 2,
    );
  }
}
