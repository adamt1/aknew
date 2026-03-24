
import { google } from 'googleapis';

async function shareServiceAccountCalendar() {
  const clientEmail = 'calendar-bot@rotem-whatsapp-bot.iam.gserviceaccount.com';
  const privateKey = `-----BEGIN PRIVATE KEY-----\nMIIEvgIBADANBgkqhkiG9w0BAQEFAASCBKgwggSkAgEAAoIBAQDRLvjmA/rjEbHg\nqEGjvzYeiFJJq/tUGXLz5CiSnrM1VbboTJctBFOk2Aq3tVnccSmCJJBJumm5gGAv\nRTAZ/cK+IJZ108eQhop5QLaUXVS3yQs98kyAohoHE9YL1SVDk8Wu0ymA/omQebSx\nFTZ7BhjgcgUlnWi/Pa/XM93KJ1xteibr6UaPLpNV/ZxTVy94QUOSxs7ZPoDMeK7i\nxdIESmzSC8Nswewa3e1W2aJKSIQc7qTB+W7FCrxoOyGuRI/t/Kt+0sfUf0kLoams\nS1ur247sE/H/hLSX5agowFRj0x2jKb6hqE+ujQRjDubgwXGu8FqPleMjy79pXv75\nRZbSQi2hAgMBAAECggEAZT/4rpEHm2gBsq2OU/1l6yJtvgYWGQ9WYjGx58IUGQE7\njrYfyGTbPaNqkKAhdj956WncQyuNKAI4zDiPf00iOVfZq/+NjWlp1iXaGfcQ3gJc\nRCgnGm4b7ggOZ1zMdCivGx9PbAYIPNuD9+C+JY7+dIkL77iArmxj0+ThegtSRBRm\n/ZcKe56S+r7Nxt5YpkD0dtcKerdluj807si6IUnLXmqQpsXhZr8pyRNs+FHRvqFq\njPYGLmF4pqE+iPpGZy/k9TQVYYN4omS0yyBq5gW/Rz0FAeMuaufUKQaY3+OtpPX2\nmizg20hkDIOgIFMsna9EFKgcmeizPASMC7EFmW0dBwKBgQD30itqCLefHhJLW8PX\ndzZ/UlaerWTDA9w1i7hHc7GCha40woL2dMZo+4beFGr113izaNFeWz3JMEEF+Plz\njc0hrkcYq6/Gbi95PMt2vzIAU9wXk5W/D5oglLmCEMUQsLNNMR9RQlxpwb3mIPBu\nImMq0SeuxKjQnC2moFLJEF1pLwKBgQDYFlseEgbepOSy0Tudud+zusRPSsXM3JkC\nqcu1gaXXrK4jVxspodelFnI4RkpC5U58ZTiM6uk5UN/f5dqB/xcc00bu5blR5WbM\n83hv6BG2jOrdfjsuFoG6kTEhbts+f0ulajI0zXdr9OoicFq/wpteKAtLLpZnlkXE\nLhY96O6CLwKBgCgImKDRdbBLsFLiKRn2lSQuTfXmNt/WEM3Jm2RXiTZ3l/PH9FYR\n+TdeYqQfkkPSohoBdckTXkDQ/cAUP1/uaVPmjm+q1INuq1affpLZQh+RbH2WhttN\nju1yeSFMyjjvApgWtmNvH/Spqp6xdYWlInX5QbrW5BqHEEzZm2YFscFbAoGBAIN3\nFnh0/zj1mS4xndOYAkGWn1ieZTj9/RlhtE35Uqykok1d8Wiizk/iGBukqAmK+PU1\nn/Ib+Uilq47MiOQODkG7SKyPlu/8YU7P0bZDuoMVuM6IvfiMOOEI9JsilsCvMZax\nxVnap41GtCu/r3Z7L4tZUYWsElVzV37Di0SfMnyBAoGBAKUw5rqHZ2QJuRpGMVSO\nMAFdjBxzDU2RwciM6zNu4morcNbfgd5YEBBzaAF7CbtGjiaBmk9uw2dza/5GUAlf\nocJzGm+n121RyMiLE8nT8tz8ScrKgs1HHTHRE9Crp2CuSA/nbn9GJkVbfW1VRStj\nWJXLDiiz9bBymDMhdmFnroxP\n-----END PRIVATE KEY-----\n`.replace(/\\n/g, '\n');

  const auth = new google.auth.JWT({
    email: clientEmail,
    key: privateKey,
    scopes: ['https://www.googleapis.com/auth/calendar'],
  });

  const calendar = google.calendar({ version: 'v3', auth });

  const targetUserEmails = ['tayaramadam25@gmail.com', 'a.k.cleaningg@gmail.com'];

  for (const targetUserEmail of targetUserEmails) {
    try {
      console.log(`Attempting to share service account primary calendar with ${targetUserEmail}...`);
      await calendar.acl.insert({
        calendarId: 'primary',
        requestBody: {
          role: 'writer', // Let them see and edit
          scope: {
            type: 'user',
            value: targetUserEmail,
          },
        },
      });
      console.log(`Successfully shared calendar with ${targetUserEmail}!`);
    } catch (error: any) {
      console.error(`Error sharing with ${targetUserEmail}:`, error.message);
    }
  }
}

shareServiceAccountCalendar();
