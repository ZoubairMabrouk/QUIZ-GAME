import 'dart:convert';

import 'package:flutter_test/flutter_test.dart';
import 'package:http/http.dart' as http;
import 'package:http/testing.dart';
import 'package:quiz_game/api.dart';

void main() {
  test('concurrent requests rotate the refresh token only once', () async {
    var refreshes = 0;
    final api = QuizApi(
      'http://localhost:3000',
      client: MockClient((request) async {
        if (request.url.path == '/auth/refresh') {
          refreshes++;
          await Future<void>.delayed(const Duration(milliseconds: 10));
          return http.Response(
            jsonEncode({
              'accessToken': 'new-access',
              'refreshToken': 'new-refresh',
              'expiresAt': DateTime.now()
                  .toUtc()
                  .add(const Duration(minutes: 15))
                  .toIso8601String(),
            }),
            200,
          );
        }
        expect(request.headers['Authorization'], 'Bearer new-access');
        return http.Response('{}', 200);
      }),
    );
    api.setSession({
      'accessToken': 'old',
      'refreshToken': 'refresh',
      'expiresAt': DateTime.fromMillisecondsSinceEpoch(0).toIso8601String(),
    });
    await Future.wait([api.call('/me'), api.call('/wallet')]);
    expect(refreshes, 1);
    expect(api.refreshToken, 'new-refresh');
    api.dispose();
  });
  test(
    'failed refresh clears credentials and never replays rotation',
    () async {
      var calls = 0;
      final api = QuizApi(
        'http://localhost:3000',
        client: MockClient((_) async {
          calls++;
          return http.Response('{"error":"Invalid refresh token"}', 401);
        }),
      );
      api.setSession({
        'accessToken': 'old',
        'refreshToken': 'old',
        'expiresAt': DateTime.fromMillisecondsSinceEpoch(0).toIso8601String(),
      });
      await expectLater(api.call('/me'), throwsA(isA<ApiException>()));
      expect(api.signedIn, false);
      expect(calls, 1);
      api.dispose();
    },
  );
}
