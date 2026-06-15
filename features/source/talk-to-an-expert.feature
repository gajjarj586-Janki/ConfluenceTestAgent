Feature: Form submission on Offer Detail Page

  Background:
    Given I am a user on the the Offer Detail Page
  
  @TalkToExpert 
  Scenario: Form submission on Offer Detail Page
    Given the user has loaded the test data from the confluence page "Automation Test Data" and find the test data "Talk to an expert - Test Data"
    And the user navigates to Offer Detail Page
    And the user sets location postcode from test data
    And Click on Set Dealer
    Then Location modal will closed
    When the user clicks on Talk to an expert
    Then the Talk to an expert modal is displayed
    And the user fills Title from test data
    And the user fills first name from test data
    And the user fills last name from test data
    And the user fills email address from test data
    And the user fills phone number from test data
    And user clicks Next
    Then Your Location is displayed
    When user clicks Next
    And the user fills Reason for your enquiry from test data
    And user fills Additional information from test data
    And the user clicks Send Enquiry
    Then the Talk to an expert form submission is successful
    And it will return status code 200 in the API
    And a "Your enquiry has been sent. Thank you." confirmation message should be displayed

    