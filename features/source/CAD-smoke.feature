Feature: Hyundai Contact a dealer - Verify status code in API Payload
as a hyundai customer
I want to verify the status of my submission

Background:
Given the user has loaded the test data from the confluence page "Automation Test Data" and find the test data "Contact A Dealer Form – Test Data"
And the user navigates to Contact a dealer page
And Form has loaded successfully


#Successful submission
 # ============================================================
  # SUCCESSFUL SUBMISSION → STATUS CODE 200
  # ============================================================

  @regression @Positive @StatusCode200
  Scenario: Successful submission returns status code 200
    Given the user has selected dealer
    When the user enters a valid first name
    And the user enters a valid last name
    And the user enters a valid email address
    And the user enters a valid phone number
    And the user enters purchase intent
    And the user selects model and powertrain
    And the user accepts the privacy consent checkbox
    And the user accepts the marketing authorisation
    And the user submits the contact a dealer form
    Then the form should be submitted successfully
    And it will return status code 200 in the API
    And a confirmation message should be displayed

 