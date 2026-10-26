import 'dart:convert';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:quiz_game/api.dart';
import 'package:quiz_game/competitions_page.dart';
import 'package:quiz_game/competition_play_page.dart';

void main() {
  testWidgets('Competition question, answer, spectator and final rewards fit mobile RTL', (tester) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    var phase = 'PHASE_1';
    int? choice;
    var revision = 1;
    final api = QuizApi('http://test', client: MockClient((request) async {
      if (request.url.path.endsWith('/answers')) {
        choice = (jsonDecode(request.body) as Map<String, dynamic>)['choice'] as int;
        return http.Response('{"accepted":true}', 200);
      }
      final closed = phase != 'PHASE_1';
      return http.Response(jsonEncode({
        'id': 'event', 'title': 'Tournoi', 'revision': revision, 'state': phase,
        'serverTime': DateTime.now().toUtc().toIso8601String(),
        'startsAt': DateTime.now().toUtc().toIso8601String(),
        'deadline': DateTime.now().toUtc().add(const Duration(seconds: 10)).toIso8601String(),
        'nextTransitionAt': null, 'questionNo': 0, 'survivors': closed ? 1 : 2, 'participants': 2,
        'me': {'eliminated': closed, 'rank': closed ? 2 : null, 'milestoneAwarded': false},
        'question': {'text': 'Quelle réponse ?', 'choices': ['A', 'B', 'C', 'D'], 'difficulty': 1},
        'myChoice': choice,
        if (closed) 'correction': {'correctIndex': 0, 'explanation': 'Explication finale'},
        if (phase == 'TERMINEE') ...{
          'rewards': <dynamic>[], 'results': [{'pseudo': 'Vainqueur', 'rank': 1, 'cumulative_ms': 1200}],
          'tieCommitment': 'commitment', 'tieSeed': 'seed', 'resolutionReason': 'last_survivor',
        },
      }), 200);
    }));
    api.accessToken = 'test'; api.expiresAt = DateTime.utc(2099);
    addTearDown(api.dispose);
    await tester.pumpWidget(MaterialApp(home: Directionality(textDirection: TextDirection.rtl, child: CompetitionPlayPage(api: api, id: 'event', enableRealtime: false))));
    await tester.pumpAndSettle();
    expect(find.text('Quelle réponse ?'), findsOneWidget);
    expect(find.text('Explication finale'), findsNothing);
    await tester.tap(find.text('B')); await tester.pumpAndSettle();
    expect(find.text('Réponse enregistrée. Correction à la clôture.'), findsOneWidget);
    phase = 'PHASE_2'; revision++;
    await tester.tap(find.byTooltip('Actualiser')); await tester.pumpAndSettle();
    expect(find.text('Mode spectateur • Rang : 2'), findsOneWidget);
    expect(find.text('Explication finale'), findsOneWidget);
    phase = 'TERMINEE'; revision++;
    await tester.tap(find.byTooltip('Actualiser')); await tester.pumpAndSettle();
    expect(find.text('Votre rang : 2'), findsOneWidget);
    expect(tester.takeException(), isNull);
    await tester.pumpWidget(const SizedBox.shrink());
  });
  testWidgets('Competition registration uses API and displays confirmed receipt on mobile RTL', (tester) async {
    tester.view.physicalSize = const Size(360, 800);
    tester.view.devicePixelRatio = 1;
    addTearDown(tester.view.resetPhysicalSize);
    addTearDown(tester.view.resetDevicePixelRatio);
    var registered = false;
    var requests = 0;
    final api = QuizApi('http://test', client: MockClient((request) async {
      if (request.url.path.endsWith('/register')) {
        expect(request.method, 'POST');
        registered = true;
        requests++;
        return http.Response('{}', 200);
      }
      if (request.url.path == '/wallet') {
        return http.Response(jsonEncode({'silver': registered ? 75 : 100}), 200);
      }
      return http.Response(jsonEncode({'competitions': [{
        'id': 'event', 'title': 'Compétition de test',
        'starts_at': '2099-01-01T12:00:00Z', 'server_time': '2099-01-01T10:00:00Z',
        'time_zone': 'Africa/Lagos', 'participants': registered ? 1 : 0,
        'silver_cost': 25, 'state': 'INSCRIPTIONS_OUVERTES',
        'registered_at': registered ? '2099-01-01T10:00:00Z' : null,
        'refunded_at': null,
      }]}), 200);
    }));
    api.accessToken = 'test';
    api.expiresAt = DateTime.utc(2099);
    addTearDown(api.dispose);
    await tester.pumpWidget(MaterialApp(home: Directionality(textDirection: TextDirection.rtl, child: CompetitionsPage(api: api))));
    await tester.pumpAndSettle();
    expect(find.text('Solde : 100 Silver'), findsOneWidget);
    await tester.tap(find.text('S’inscrire • 25 Silver'));
    await tester.pumpAndSettle();
    expect(find.text('Inscription confirmée'), findsOneWidget);
    expect(find.text('Solde : 75 Silver'), findsOneWidget);
    expect(requests, 1);
    expect(tester.takeException(), isNull);
  });
}
