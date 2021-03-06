const CoreService = require('../CoreService')

class GoogleCalendarService extends CoreService {
  /* **************************************************************************/
  // Class
  /* **************************************************************************/

  static get type () { return CoreService.SERVICE_TYPES.CALENDAR }
  static get humanizedType () { return 'Google Calendar' }
  static get humanizedLogos () {
    return [
      'images/google/logo_calendar_32px.png',
      'images/google/logo_calendar_48px.png',
      'images/google/logo_calendar_64px.png',
      'images/google/logo_calendar_128px.png'
    ]
  }

  /* **************************************************************************/
  // Properties
  /* **************************************************************************/

  get url () { return 'https://calendar.google.com' }
}

module.exports = GoogleCalendarService
