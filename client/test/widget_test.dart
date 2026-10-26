import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:quiz_game/api.dart';
import 'package:quiz_game/game_controller.dart';
import 'package:quiz_game/main.dart';

GameController controller() => GameController(
      QuizApi(
        'http://localhost:3000',
        client: MockClient((request) async {
          final body = switch (request.url.path) {
            '/config' => {
                'otpMode': 'mock',
                'channels': ['sms', 'whatsapp'],
              },
            '/auth/otp/request' => {'challengeId': 'test', 'resendAfter': 60},
            '/auth/otp/verify' => {
                'user': {'id': 'a', 'pseudo': 'Alice', 'phoneVerified': false},
                'accessToken': 'access',
                'refreshToken': 'refresh',
                'expiresAt': DateTime.now()
                    .toUtc()
                    .add(const Duration(minutes: 15))
                    .toIso8601String(),
              },
            '/wallet' => {'silver': 20, 'golden': 0, 'entries': []},
            _ => <String, dynamic>{},
          };
          return http.Response(jsonEncode(body), 200);
        }),
      ),
    );
Map<String, dynamic> fixture(String status) => {
      'code': 'ABC234',
      'hostId': 'a',
      'status': status,
      'revision': 1,
      'serverTime': 1,
      'questionNumber': 1,
      'questionCount': 3,
      'durationMs': 10000,
      'remainingMs': 8000,
      'players': [
        {'id': 'a', 'pseudo': 'Alice', 'ready': true},
        {'id': 'b', 'pseudo': 'Bob', 'ready': true},
      ],
      'ranking': [
        {'id': 'a', 'pseudo': 'Alice', 'score': 100, 'rank': 1},
        {'id': 'b', 'pseudo': 'Bob', 'score': 0, 'rank': 2},
      ],
      'answered': false,
      'selectedChoice': null,
      'question': {
        'id': 'q1',
        'text': 'Quelle est la capitale de la Tunisie ?',
        'choices': ['Tunis', 'Sfax', 'Sousse', 'Bizerte'],
      },
      if (status == 'results' || status == 'finished') ...{
        'correctIndex': 0,
        'explanation': 'Tunis est la capitale de la Tunisie.',
      },
      if (status == 'finished')
        'rewards': [
          {'userId': 'a', 'amount': 20},
          {'userId': 'b', 'amount': 12},
        ],
    };
void main() {
  testWidgets('phone and OTP flow reaches the home screen', (tester) async {
    final g = controller();
    await tester.pumpWidget(QuizApp(controller: g));
    await tester.pump(const Duration(milliseconds: 100));
    final button = tester.widget<FilledButton>(
      find.byKey(const Key('request-otp')),
    );
    expect(button.onPressed, isNull);
    await tester.enterText(
      find.byKey(const Key('phone-input')),
      '+12025550123',
    );
    await tester.ensureVisible(find.byType(CheckboxListTile));
    await tester.tap(find.byType(CheckboxListTile));
    await tester.pump();
    await tester.ensureVisible(find.byKey(const Key('request-otp')));
    await tester.tap(find.byKey(const Key('request-otp')));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.byKey(const Key('otp-input')), findsOneWidget);
    await tester.enterText(find.byKey(const Key('otp-input')), '000000');
    await tester.ensureVisible(find.byKey(const Key('verify-otp')));
    await tester.tap(find.byKey(const Key('verify-otp')));
    await tester.pump(const Duration(milliseconds: 100));
    expect(find.byKey(const Key('create-room')), findsOneWidget);
    expect(find.byKey(const Key('join-room')), findsOneWidget);
    await tester.pumpWidget(const SizedBox());
  });
  for (final status in ['lobby', 'question', 'results', 'finished']) {
    testWidgets('$status fits a narrow mobile screen', (tester) async {
      tester.view.physicalSize = const Size(360, 800);
      tester.view.devicePixelRatio = 1;
      addTearDown(tester.view.resetPhysicalSize);
      addTearDown(tester.view.resetDevicePixelRatio);
      final g = controller();
      g.user = {'id': 'a', 'pseudo': 'Alice'};
      g.roomCode = 'ABC234';
      g.acceptState(fixture(status));
      g.live = true;
      await tester.pumpWidget(QuizApp(controller: g));
      await tester.pump(const Duration(milliseconds: 100));
      expect(tester.takeException(), isNull);
      if (status == 'question') {
        expect(find.text('Tunis est la capitale de la Tunisie.'), findsNothing);
      }
      if (status == 'finished') {
        expect(find.byKey(const Key('finished-title')), findsOneWidget);
      }
      await tester.pumpWidget(const SizedBox());
    });
  }
  test('out-of-order state never regresses the game', () {
    final g = controller();
    g.roomCode = 'ABC234';
    g.acceptState(fixture('results'));
    g.acceptState({...fixture('question'), 'revision': 0});
    expect(g.status, 'results');
    g.dispose();
  });
}
